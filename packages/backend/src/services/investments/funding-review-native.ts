import { TRANSACTION_TRANSFER_NATURE as Nature, TRANSACTION_TYPES as Type } from '@bt/shared/types';
import { ValidationError } from '@js/errors';
import { connection } from '@models/connection';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import BrokerPortfolioData from '@models/investments/broker-portfolio-data.model';
import Accounts from '@models/accounts.model';
import { findTransactions } from '@models/transactions-query';
import { linkTransactionToPortfolio } from '@services/investments/portfolios/transfers/link-transaction-to-portfolio.service';
import { directCashTransaction } from '@services/investments/portfolios/transfers/direct-cash-transaction.service';
import { createHash } from 'node:crypto';
import { Op,QueryTypes,Transaction } from 'sequelize';
import { getReviewItem } from './funding-review';
import { listInvestmentGroups } from './groups';

const fail=(message:string):never=>{throw new ValidationError({message});};
const shift=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
type Item=Awaited<ReturnType<typeof getReviewItem>>;
type Link={transactionId:string;portfolioTransferId:string};
async function candidates(userId:number,item:Item,transaction?:Transaction) {
  const portfolioIds=item.portfolios.map(p=>p.id);
  const [transfers,links]=await Promise.all([
    PortfolioTransfers.findAll({where:{userId,isAdjustment:false,[Op.or]:[
      {transactionId:item.id},
      {toPortfolioId:{[Op.in]:portfolioIds},fromPortfolioId:null,currencyCode:item.currency,date:{[Op.between]:[shift(item.date,-7),shift(item.date,7)]}},
    ]},transaction}),
    connection.sequelize.query<Link>('SELECT "transactionId","portfolioTransferId" FROM "InvestmentFundingNativeLinks" WHERE "userId"=:userId',{replacements:{userId},type:QueryTypes.SELECT,transaction}),
  ]);
  const linkedIds=links.filter(l=>l.transactionId===item.id).map(l=>l.portfolioTransferId);
  // A prior association remains visible even if its amount/date was edited.
  for(const transferId of linkedIds) if(!transfers.some(t=>t.id===transferId)){
    const row=await PortfolioTransfers.findOne({where:{id:transferId,userId},transaction});
    if(row) transfers.push(row);
  }
  const linked=transfers.filter(t=>t.transactionId===item.id||linkedIds.includes(t.id));
  const matches=transfers.filter(t=>!t.isAdjustment&&!t.fromPortfolioId&&t.toPortfolioId&&portfolioIds.includes(t.toPortfolioId)&&t.currencyCode===item.currency&&t.amount.toCents()===Math.round(item.amount*100)&&t.date>=shift(item.date,-7)&&t.date<=shift(item.date,7));
  const available=matches.filter(t=>(!t.transactionId||t.transactionId===item.id)&&!links.some(l=>l.portfolioTransferId===t.id&&l.transactionId!==item.id));
  return {linked,available,conflict:linked.length>1||linked.some(t=>!matches.some(m=>m.id===t.id))};
}
export async function nativeFundingOptions(userId:number,id:string,portfolioId:string) {
  const item=await getReviewItem(userId,id,portfolioId);
  const {linked,available,conflict}=await candidates(userId,item);
  return {linked:linked.length===1&&!conflict,conflict,candidates:available.map(t=>({id:t.id,portfolioId:t.toPortfolioId,date:t.date,amount:t.amount.toNumber(),affectsCash:t.affectsCash,description:t.description??''}))};
}
export async function recordNativeFunding(userId:number,id:string,input:{portfolioId:string;fingerprint:string;mode:'existing'|'add-cash'|'historical';transferId?:string}) {
  return connection.sequelize.transaction(async transaction=>{
    await connection.sequelize.query('SELECT pg_advisory_xact_lock(71404,:userId)',{replacements:{userId},transaction});
    const item=await getReviewItem(userId,id,input.portfolioId);
    if(item.fingerprint!==input.fingerprint) return fail('The contribution changed. Refresh and review again.');
    const portfolio=await Portfolios.findOne({where:{id:input.portfolioId,userId},transaction,lock:transaction.LOCK.UPDATE});
    if(!portfolio) return fail('Portfolio not found');
    const {linked,available,conflict}=await candidates(userId,item,transaction);
    if(conflict) return fail('Existing funding evidence conflicts; review the original transfer before proceeding.');
    if(linked.length){
      if(linked[0]!.toPortfolioId!==portfolio.id) return fail('Already linked to another portfolio.');
      return {transferId:linked[0]!.id,created:false};
    }
    if(input.mode==='existing'){
      const transfer=available.find(t=>t.id===input.transferId&&t.toPortfolioId===portfolio.id);
      if(!transfer) return fail('The selected existing transfer is no longer available.');
      await connection.sequelize.query('INSERT INTO "InvestmentFundingNativeLinks" ("transactionId","userId","portfolioTransferId") VALUES (:id,:userId,:transferId)',{replacements:{id,userId,transferId:transfer.id},transaction});
      return {transferId:transfer.id,created:false};
    }
    if(available.length) return fail('A possible existing contribution was found. Link it instead of creating another.');
    const group=(await listInvestmentGroups(userId)).groups.find(g=>g.id===item.groupId);
    if(!group) return fail('Investment group changed');
    // Mapped source balance is already included separately. Never increase a
    // second net-worth-bearing portfolio as a side effect of this workflow.
    if(group.sourceAccountId&&portfolio.isEnabled) return fail('Exclude the mirrored portfolio from net worth before recording this contribution.');
    const rows=await findTransactions({access:{accountOwner:userId},planned:'exclude',balanceAdjustments:'exclude',transfers:'include',completeness:'all',where:{id},transaction,lock:transaction.LOCK.UPDATE});
    const bank=rows[0];
    if(!bank||bank.transactionType!==Type.expense||bank.currencyCode!==item.currency||bank.amount.toCents()!==Math.round(item.amount*100)||bank.refundLinked||bank.paymentParentId||bank.externalData?.hold===true) return fail('Bank payment changed.');
    const source=await BrokerPortfolioData.findByPk(portfolio.id,{transaction});
    const anchor=[...(source?.data.snapshots??[]).map(s=>s.asOf.slice(0,10)),...(source?.data.accountObservations??[]).map(s=>s.date)].sort().at(-1);
    if(input.mode==='add-cash'&&anchor&&item.date<=anchor) return fail('The deposit predates a recorded brokerage observation. Review historical-only funding instead.');
    const affectsCash=input.mode==='add-cash';
    let transfer:PortfolioTransfers;
    if(!bank.transferId&&[Nature.not_transfer,Nature.transfer_out_wallet].includes(bank.transferNature)){
      // Existing canonical link reclassifies the source debit without creating
      // another bank transaction, and implements historical-only cash handling.
      transfer=await linkTransactionToPortfolio({userId,transactionId:id,portfolioId:portfolio.id,affectsCash});
    }else if(bank.transferId&&bank.transferNature===Nature.common_transfer){
      // Keep both existing bank legs intact. Only create the excluded mirror's
      // native contribution; the association below is independent of bank links.
      if(!group.sourceAccountId||item.destinationAccountId!==group.sourceAccountId||portfolio.isEnabled) return fail('The paired transfer is not verified against an excluded mapped brokerage portfolio.');
      const account=await Accounts.findOne({where:{id:group.sourceAccountId,userId},transaction});
      if(!account) return fail('Mapped source account unavailable');
      transfer=await directCashTransaction({userId,portfolioId:portfolio.id,type:'deposit',amount:bank.amount.toDecimalString(10),currencyCode:item.currency,date:item.date,description:'Confirmed bank contribution',sourceRowId:createHash('sha256').update('bank-funding:'+userId+':'+id).digest('hex'),affectsCash});
      await connection.sequelize.query('INSERT INTO "InvestmentFundingNativeLinks" ("transactionId","userId","portfolioTransferId") VALUES (:id,:userId,:transferId)',{replacements:{id,userId,transferId:transfer.id},transaction});
    }else return fail('This transaction already has another financial link. Review the original transfer.');
    return {transferId:transfer.id,created:true};
  });
}
