import { INVESTMENT_TRANSACTION_CATEGORY as Category } from '@bt/shared/types/investments';
import { easternDate } from '@bt/shared/types/investment-market';
import { ValidationError } from '@js/errors';
import { connection } from '@models/connection';
import BrokerPortfolioData from '@models/investments/broker-portfolio-data.model';
import Holdings from '@models/investments/holdings.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import { parseBrokerPortfolioExport } from '@services/import-export/investment-transactions-parser/broker-export-parser';
import { createInvestmentTransaction } from '@services/investments/transactions/create.service';
import { getFundingCalendar } from '@services/stats/funding-calendar';
import { Big } from 'big.js';
import { Op, QueryTypes, Transaction } from 'sequelize';

import { getReviewItem } from './funding-review';
import { classifyCsvBuys, matchingDepositRows, type ExistingExecution } from './funding-review-csv-model';

const fail=(message:string):never=>{throw new ValidationError({message});};
const shift=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
const brokerName=(name:string)=>/^m1(?:\s|$)/i.test(name)?'m1':/^robinhood(?:\s|$)/i.test(name)?'robinhood':null;
interface Input {portfolioId:string;fileContent:string}
async function buildPreview(userId:number,id:string,input:Input,transaction?:Transaction){
  const item=await getReviewItem(userId,id,input.portfolioId);
  if(item.currency!=='USD') return fail('This broker CSV workflow currently supports USD statements.');
  const portfolio=await Portfolios.findOne({where:{id:input.portfolioId,userId},transaction});
  if(!portfolio) return fail('Portfolio not found');
  const source=await BrokerPortfolioData.findByPk(portfolio.id,{transaction});
  const expected=source?.data.broker??brokerName(item.groupName)??brokerName(portfolio.name);
  if(!expected||!['m1','robinhood'].includes(expected)) return fail('This portfolio does not have a supported M1 or Robinhood broker identity.');
  let parsed:ReturnType<typeof parseBrokerPortfolioExport>;
  try{parsed=parseBrokerPortfolioExport({fileContent:input.fileContent,accountKey:source?.data.accountKey??portfolio.id});}
  catch{return fail('Unsupported or invalid brokerage CSV. Upload the detailed activity export.');}
  if(parsed.broker!==expected) return fail('The CSV broker does not match the selected portfolio.');
  if(parsed.events.length>5000) return fail('Select a CSV with no more than 5,000 activity rows.');
  const buys=parsed.events.filter(e=>e.kind==='trade'&&e.action==='Buy');
  const symbols=[...new Set(buys.flatMap(e=>e.symbol?[e.symbol]:[]))];
  const cusips=[...new Set(buys.flatMap(e=>e.securityIdType==='CUSIP'&&e.securityId?[e.securityId]:[]))];
  const dates=buys.map(e=>e.date).sort();
  const [securities,native]=await Promise.all([
    symbols.length?Securities.findAll({where:{currencyCode:'USD',[Op.or]:[{symbol:{[Op.in]:symbols}},...(cusips.length?[{cusip:{[Op.in]:cusips}}]:[])]},attributes:['id','symbol','cusip','currencyCode'],transaction}):[],
    dates.length?InvestmentTransaction.findAll({where:{portfolioId:portfolio.id,category:{[Op.in]:[Category.buy,Category.sell]},date:{[Op.gte]:new Date(shift(dates[0]!,-1)),[Op.lt]:new Date(shift(dates.at(-1)!,2))}},include:[{model:Securities,as:'security',attributes:['symbol']}],limit:10001,transaction}):[],
  ]);
  if(native.length>10000) return fail('This date range contains too many native trades; use a shorter export.');
  const existing:ExistingExecution[]=native.map(t=>({id:t.id,sourceRowId:t.name?.match(/^\[broker-row:([a-f0-9]{64})\]/)?.[1]??null,date:t.date.toISOString().slice(0,10),securityId:t.securityId,symbol:t.security?.symbol??'',action:t.category===Category.buy?'Buy':'Sell',quantity:t.quantity.toDecimalString(10),price:t.price.toDecimalString(10),amount:t.settlementAmount.toDecimalString(10),currency:t.settlementCurrencyCode}));
  const anchor=[...(source?.data.snapshots??[]).map(s=>s.asOf.slice(0,10)),...(source?.data.accountObservations??[]).map(s=>s.date)].sort().at(-1)??null;
  const recordedIds=new Set((source?.data.sourceEvents??[]).flatMap(e=>typeof e.sourceRowId==='string'?[e.sourceRowId]:[]));
  const rows=classifyCsvBuys(parsed.events,existing,securities.map(s=>({id:s.id,symbol:s.symbol??'',cusip:s.cusip,currency:s.currencyCode})),recordedIds,anchor,shift(item.date,-3),easternDate());
  const depositRows=matchingDepositRows(parsed.events,item.date,item.amount);
  const {entries}=await getFundingCalendar({userId,from:shift(item.date,-3),to:shift(item.date,3)});
  const similarPayments=entries.filter(e=>e.group==='Investments'&&e.currency===item.currency&&Math.round(e.amount*100)===Math.round(item.amount*100));
  const uniqueDeposit=depositRows.length===1&&similarPayments.length===1&&similarPayments[0]!.id===item.id;
  const preview={fileHash:parsed.fileHash,broker:parsed.broker,totalRows:parsed.events.length,matched:rows.filter(r=>r.status==='existing').length,newBuys:rows.filter(r=>r.status==='new').length,review:rows.filter(r=>r.status==='review').length,otherRows:parsed.events.length-buys.length,
    depositMatches:depositRows.length,depositStatus:uniqueDeposit?'unique':depositRows.length?'ambiguous':'missing',depositSourceRowId:uniqueDeposit?depositRows[0]!.sourceRowId:null,
    rows:rows.filter(r=>r.date>=shift(item.date,-3)&&r.date<=easternDate()),
    issues:parsed.issues.slice(0,15)};
  return {item,portfolio,preview};
}
export async function previewFundingCsv(userId:number,id:string,input:Input){
  return (await buildPreview(userId,id,input)).preview;
}
export async function applyFundingCsv(userId:number,id:string,input:Input&{fileHash:string;sourceRowIds:string[];confirmCash:boolean}){
  if(!input.confirmCash) return fail('Confirm the deposit is already represented in the portfolio cash and these purchases are not already reflected in its holdings.');
  if(new Set(input.sourceRowIds).size!==input.sourceRowIds.length) return fail('Select each execution once.');
  return connection.sequelize.transaction(async transaction=>{
    await connection.sequelize.query('SELECT pg_advisory_xact_lock(71404,:userId)',{replacements:{userId},transaction});
    // Same lock as canonical trade creation: a concurrent CSV or MCP create
    // cannot slip between fresh duplicate detection and this batch.
    await connection.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))',{replacements:{key:`investment-trade:${userId}:${input.portfolioId}`},transaction});
    const {item,portfolio,preview}=await buildPreview(userId,id,input,transaction);
    if(preview.fileHash!==input.fileHash) return fail('CSV changed; preview it again.');
    if(!preview.depositSourceRowId) return fail('The deposit is not uniquely matched in this CSV; review the funding evidence before importing.');
    const chosen=preview.rows.filter(r=>input.sourceRowIds.includes(r.sourceRowId));
    if(chosen.length!==input.sourceRowIds.length||chosen.some(r=>r.status==='review')) return fail('A selected execution is ambiguous or changed. Refresh the preview.');
    const newRows=chosen.filter(r=>r.status==='new');
    // Do not create another funding transaction. Check available native cash
    // before replaying actual missing executions. Anchored or unknown cash stays in review.
    const cash=await PortfolioBalances.findOne({where:{portfolioId:portfolio.id,currencyCode:'USD'},transaction,lock:transaction.LOCK.UPDATE});
    const cost=newRows.reduce((n,r)=>n.plus(r.amount),new Big(0));
    if(cost.gt(0)&&(!cash||cash.availableCash.toBig().lt(cost))) return fail('Insufficient recorded portfolio cash. Reconcile the existing contribution first; the CSV will not create a second deposit.');
    // Record the deposit evidence, one source occurrence per bank payment. This
    // is not a PortfolioTransfer and never changes a financial balance.
    const prior=await connection.sequelize.query<{transactionId:string;sourceRowId:string;portfolioId:string}>('SELECT "transactionId","sourceRowId","portfolioId" FROM "InvestmentFundingCsvEvidence" WHERE "userId"=:userId AND ("transactionId"=:id OR ("portfolioId"=:portfolioId AND "sourceRowId"=:sourceRowId))',{replacements:{userId,id,portfolioId:portfolio.id,sourceRowId:preview.depositSourceRowId},type:QueryTypes.SELECT,transaction});
    if(prior.some(p=>p.transactionId!==id||p.sourceRowId!==preview.depositSourceRowId||p.portfolioId!==portfolio.id)) return fail('This deposit source is already associated with a different bank payment or portfolio.');
    await connection.sequelize.query('INSERT INTO "InvestmentFundingCsvEvidence" ("transactionId","userId","portfolioId","sourceRowId","fileHash") VALUES (:id,:userId,:portfolioId,:sourceRowId,:fileHash) ON CONFLICT ("transactionId") DO NOTHING',{replacements:{id,userId,portfolioId:portfolio.id,sourceRowId:preview.depositSourceRowId,fileHash:preview.fileHash},transaction});
    const tradeIds=chosen.filter(r=>r.status==='existing').flatMap(r=>r.tradeId?[r.tradeId]:[]);
    for(const row of newRows.sort((a,b)=>a.date.localeCompare(b.date)||a.sourceRowId.localeCompare(b.sourceRowId))){
      if(!row.securityId) return fail('Security identity changed');
      const holding=await Holdings.findOne({where:{portfolioId:portfolio.id,securityId:row.securityId},transaction});
      if(!holding) return fail('Add the verified security to the portfolio first.');
      const result=await createInvestmentTransaction({userId,portfolioId:portfolio.id,securityId:row.securityId,category:Category.buy,date:row.date+'T12:00:00.000Z',quantity:row.quantity,price:row.price,fees:'0',settlementCurrencyCode:'USD',settlementAmount:row.amount,sourceRowId:row.sourceRowId,brokerRoundedSettlement:true,name:'Broker CSV purchase'});
      tradeIds.push(result.id);
    }
    return {created:newRows.length,existing:chosen.length-newRows.length,tradeIds,depositLinked:true,amount:item.amount};
  });
}
