import { INVESTMENT_TRANSACTION_CATEGORY as Category } from '@bt/shared/types/investments';
import { easternDate } from '@bt/shared/types/investment-market';
import { ValidationError } from '@js/errors';
import { connection } from '@models/connection';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Securities from '@models/investments/securities.model';
import { getFundingCalendar } from '@services/stats/funding-calendar';
import { Op, QueryTypes, Transaction } from 'sequelize';
import { listInvestmentGroups } from './groups';
import { coveredAmount, matchReviewGroup, reviewFingerprint } from './funding-review-model';

const shift = (date: string, days: number) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0,10);
const read = <T extends object>(sql: string, replacements: Record<string, unknown>, transaction?: Transaction) =>
  connection.sequelize.query<T>(sql,{replacements,type:QueryTypes.SELECT,transaction});
const write = (sql: string,replacements: Record<string,unknown>,transaction?: Transaction) =>
  connection.sequelize.query(sql,{replacements,transaction});
const fail = (message: string): never => { throw new ValidationError({message}); };
interface Decision {transactionId:string;groupId:string;portfolioId:string;fingerprint:string;tradeCount:number;validCount:number;cashRetained:boolean}
export async function getFundingReviews(userId: number) {
  const today = easternDate();
  const from = shift(today,-90);
  const groupData = await listInvestmentGroups(userId);
  const groups = groupData.groups.filter(g => g.portfolioIds.length && (g.sourceAccountId === null || groupData.sourceAccounts.some(a=>a.id===g.sourceAccountId)));
  if (!groups.length) return {items:[], reminderDue:false, lookbackFrom:from};
  // Reuse the posted transaction classifier, not principal/Sheets cash-flow amounts.
  const {entries} = await getFundingCalendar({userId,from,to:shift(today,-3)});
  const candidates = entries.filter(e=>e.group==='Investments' && e.amount>0);
  if (!candidates.length) return {items:[],reminderDue:false,lookbackFrom:from};
  const ids = candidates.map(e=>e.id);
  const [transfers, decisions, prefs] = await Promise.all([
    PortfolioTransfers.findAll({where:{userId,transactionId:{[Op.in]:ids},isAdjustment:false},attributes:['transactionId','toPortfolioId','fromPortfolioId']}),
    read<Decision>(`
      SELECT r."transactionId",r."groupId",r."portfolioId",r.fingerprint,r."tradeCount",r."cashRetained",
        COUNT(t.id) FILTER (WHERE t."updatedAt"=a."tradeUpdatedAt" AND t."portfolioId"=r."portfolioId")::int AS "validCount"
      FROM "InvestmentFundingReviews" r
      LEFT JOIN "InvestmentFundingReviewTrades" a ON a."transactionId"=r."transactionId"
      LEFT JOIN "InvestmentTransactions" t ON t.id=a."tradeId"
      WHERE r."userId"=:userId AND r."transactionId" IN (:ids) GROUP BY r."transactionId"
    `,{userId,ids}),
    read<{due:boolean}>('SELECT "snoozedUntil"<=NOW() AS due FROM "InvestmentFundingReminderPreferences" WHERE "userId"=:userId',{userId}),
  ]);
  const sources = new Map(groupData.sourceAccounts.map(a=>[a.id,a.name]));
  const items = candidates.flatMap(entry=>{
    const links=transfers.filter(t=>t.transactionId===entry.id && t.toPortfolioId && !t.fromPortfolioId);
    if(links.length>1) return [];
    const portfolioId=links[0]?.toPortfolioId ?? undefined;
    const group=matchReviewGroup(entry,groups,sources,portfolioId);
    if(!group) return [];
    const fingerprint=reviewFingerprint(entry,group);
    const prior=decisions.find(r=>r.transactionId===entry.id);
    if(prior?.fingerprint===fingerprint && prior.groupId===group.id && group.portfolioIds.includes(prior.portfolioId) && prior.validCount===prior.tradeCount) return [];
    return [{...entry,groupId:group.id,groupName:group.name,portfolioId:portfolioId??null,
      portfolios:groupData.portfolios.filter(p=>group.portfolioIds.includes(p.id)).map(p=>({id:p.id,name:p.name})),
      fingerprint, reason: portfolioId ? 'Review purchases or retained cash' : 'Confirm destination and investment activity'}];
  }).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  return {items,reminderDue:items.length>0 && (prefs[0]?.due??true),lookbackFrom:from};
}
export async function getReviewItem(userId:number,id:string,portfolioId:string) {
  const result=await getFundingReviews(userId);
  const item=result.items.find(i=>i.id===id);
  if(!item || !item.portfolios.some(p=>p.id===portfolioId) || (item.portfolioId && item.portfolioId!==portfolioId))
    return fail('Contribution or portfolio is no longer available for review');
  return item;
}
export async function listReviewPurchases(userId:number,id:string,portfolioId:string) {
  const item=await getReviewItem(userId,id,portfolioId);
  const from=shift(item.date,-3);
  const through=shift(easternDate(),1);
  const [rows,used]=await Promise.all([
    InvestmentTransaction.findAll({where:{portfolioId,category:Category.buy,settlementCurrencyCode:item.currency,date:{[Op.gte]:new Date(from),[Op.lt]:new Date(through)}},include:[{model:Securities,as:'security',attributes:['symbol']}],order:[['date','ASC'],['id','ASC']]}),
    read<{tradeId:string}>(`SELECT a."tradeId" FROM "InvestmentFundingReviewTrades" a JOIN "InvestmentFundingReviews" r ON r."transactionId"=a."transactionId" WHERE r."userId"=:userId AND r."transactionId"<>:id`,{userId,id}),
  ]);
  const taken=new Set(used.map(r=>r.tradeId));
  return rows.map(t=>({id:t.id,symbol:t.security?.symbol??'Security',date:t.date.toISOString().slice(0,10),quantity:t.quantity.toDecimalString(10),amount:t.settlementAmount.toNumber(),currency:t.settlementCurrencyCode,alreadyLinked:taken.has(t.id)}));
}
export async function resolveFundingReview(userId:number,id:string,input:{portfolioId:string;fingerprint:string;tradeIds:string[];cashRetained:boolean}) {
  const item=await getReviewItem(userId,id,input.portfolioId);
  if(item.fingerprint!==input.fingerprint) fail('Activity changed; refresh the review');
  if(new Set(input.tradeIds).size!==input.tradeIds.length) fail('Select each purchase only once');
  return connection.sequelize.transaction(async transaction=>{
    // Serialize group edits and review writes. Lock source and purchase rows to
    // prevent deletion/edits while the explicit evidence association is saved.
    await write('SELECT pg_advisory_xact_lock(71404,:userId)',{userId},transaction);
    const owned=await read<{id:string}>(`SELECT p.id FROM "InvestmentAccountGroups" g JOIN "InvestmentAccountGroupMembers" m ON m."groupId"=g.id JOIN "Portfolios" p ON p.id=m."portfolioId" WHERE g.id=:groupId AND g."userId"=:userId AND p."userId"=:userId AND p.id=:portfolioId AND p."deletedAt" IS NULL FOR UPDATE OF p,g`,{userId,groupId:item.groupId,portfolioId:input.portfolioId},transaction);
    if(!owned.length) fail('Portfolio membership changed');
    const source=await read<{amount:string;currencyCode:string}>(`SELECT t.amount,t."currencyCode" FROM "Transactions" t JOIN "Accounts" a ON a.id=t."accountId" WHERE t.id=:id AND a."userId"=:userId AND t."deletedAt" IS NULL AND NOT t."isPlanned" FOR UPDATE OF t`,{id,userId},transaction);
    if(!source[0] || Number(source[0].amount)!==Math.round(item.amount*100) || source[0].currencyCode!==item.currency) fail('Bank transaction changed');
    const trades=input.tradeIds.length?await InvestmentTransaction.findAll({where:{id:{[Op.in]:input.tradeIds},portfolioId:input.portfolioId,category:Category.buy,settlementCurrencyCode:item.currency,date:{[Op.gte]:new Date(shift(item.date,-3)),[Op.lt]:new Date(shift(easternDate(),1))}},transaction,lock:transaction.LOCK.UPDATE}):[];
    if(trades.length!==input.tradeIds.length) fail('A selected purchase is unavailable');
    if(!coveredAmount(item.amount,trades.map(t=>t.settlementAmount.toNumber()),input.cashRetained)) fail('Link purchases covering the contribution or confirm remaining cash is intentionally retained');
    await write(`DELETE FROM "InvestmentFundingReviews" WHERE "transactionId"=:id AND "userId"=:userId`,{id,userId},transaction);
    await write(`INSERT INTO "InvestmentFundingReviews" ("transactionId","userId","groupId","portfolioId",fingerprint,"cashRetained","tradeCount") VALUES (:id,:userId,:groupId,:portfolioId,:fingerprint,:cashRetained,:tradeCount)`,{id,userId,groupId:item.groupId,portfolioId:input.portfolioId,fingerprint:item.fingerprint,cashRetained:input.cashRetained,tradeCount:trades.length},transaction);
    for(const trade of trades) await write(`INSERT INTO "InvestmentFundingReviewTrades" ("transactionId","tradeId","tradeUpdatedAt") VALUES (:id,:tradeId,:updatedAt)`,{id,tradeId:trade.id,updatedAt:trade.updatedAt},transaction);
    return {resolved:true};
  });
}
export async function snoozeFundingReminder(userId:number) {
  await write(`INSERT INTO "InvestmentFundingReminderPreferences" ("userId","snoozedUntil") VALUES (:userId,NOW()+INTERVAL '1 day') ON CONFLICT ("userId") DO UPDATE SET "snoozedUntil"=EXCLUDED."snoozedUntil"`,{userId});
  return {snoozed:true};
}
