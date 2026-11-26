import { Big } from 'big.js';
import type { BrokerExportEvent } from '@services/import-export/investment-transactions-parser/broker-export-parser';

export interface ExistingExecution {
  id: string;
  sourceRowId: string | null;
  date: string;
  securityId: string;
  symbol: string;
  action: 'Buy' | 'Sell';
  quantity: string;
  price: string;
  amount: string;
  currency: string;
}
export interface CsvSecurity { id: string; symbol: string; cusip: string | null; currency: string; }
const days = (a:string,b:string) => Math.abs(Date.parse(a)-Date.parse(b))/86400000;
export function resolveCsvSecurity(event: BrokerExportEvent, securities: CsvSecurity[]) {
  const candidates = securities.filter(s => s.currency === 'USD' && s.symbol === event.symbol);
  if (event.securityId && event.securityIdType === 'CUSIP') {
    const exact = securities.filter(s=>s.currency==='USD'&&s.cusip===event.securityId);
    if (exact.length===1 && exact[0]!.symbol===event.symbol) return exact[0];
    if (exact.length || candidates.some(s=>s.cusip && s.cusip!==event.securityId)) return undefined;
  }
  return candidates.length===1 ? candidates[0] : undefined;
}
const exact = (event:BrokerExportEvent, row:ExistingExecution, securityId:string) =>
  row.securityId===securityId && row.currency==='USD' && row.action===event.action &&
  row.date===event.date && new Big(row.quantity).minus(event.quantity!).abs().lte('0.00000001') &&
  new Big(row.amount).minus(new Big(event.cashAmount!).abs()).abs().lt('0.005') &&
  new Big(row.price).minus(event.reportedPrice!).abs().lte('0.01');
export function classifyCsvBuys(events:BrokerExportEvent[], existing:ExistingExecution[], securities:CsvSecurity[], sourceRows:Set<string>, anchorDate:string|null, from:string, to:string) {
  const buys=events.filter(e=>e.kind==='trade'&&e.action==='Buy'&&e.symbol&&e.quantity&&e.reportedPrice&&e.cashAmount);
  const matched=new Set<string>();
  const rows=buys.map(e=>{
    const security=resolveCsvSecurity(e,securities);
    const base={sourceRowId:e.sourceRowId,date:e.date,symbol:e.symbol!,quantity:e.quantity!,price:e.reportedPrice!,amount:new Big(e.cashAmount!).abs().toString(),securityId:security?.id??null};
    const marker=existing.filter(t=>t.sourceRowId===e.sourceRowId);
    if(marker.length===1&&security&&exact(e,marker[0]!,security.id)&&!matched.has(marker[0]!.id)) {
      matched.add(marker[0]!.id);
      return {...base,status:'existing' as const,tradeId:marker[0]!.id,reason:'Stable source row already recorded'};
    }
    if(marker.length) return {...base,status:'review' as const,tradeId:null,reason:'Source identity exists with conflicting execution details'};
    return {...base,status:'unclassified' as const,tradeId:null,reason:''};
  });
  // Compare across source formats, not just file-row IDs. Never consume one
  // legacy execution twice or guess which identical occurrence was already imported.
  return rows.map(row=>{
    if(row.status!=='unclassified') return row;
    const event=buys.find(e=>e.sourceRowId===row.sourceRowId)!;
    const candidates=row.securityId?existing.filter(t=>!matched.has(t.id)&&exact(event,t,row.securityId!)):[];
    if(candidates.length===1){
      const trade=candidates[0]!;
      const contenders=rows.filter(other=>other.status==='unclassified'&&other.securityId===row.securityId&&exact(buys.find(e=>e.sourceRowId===other.sourceRowId)!,trade,row.securityId!));
      if(contenders.length===1){
        matched.add(trade.id);
        return {...row,status:'existing' as const,tradeId:trade.id,reason:'Unique matching recorded execution'};
      }
    }
    if(candidates.length || existing.some(t=>t.symbol===row.symbol&&t.action==='Buy'&&days(t.date,row.date)<=1))
      return {...row,status:'review' as const,reason:'Possible duplicate or repeated execution; review manually'};
    if(sourceRows.has(row.sourceRowId)) return {...row,status:'review' as const,reason:'Broker evidence exists without an unambiguous recorded trade'};
    if(!row.securityId) return {...row,status:'review' as const,reason:'Security identity is missing or ambiguous'};
    if(row.date<from||row.date>to) return {...row,status:'review' as const,reason:'Outside this contribution review window'};
    if(anchorDate&&row.date<=anchorDate) return {...row,status:'review' as const,reason:'Covered by an existing broker snapshot or account observation'};
    // Keep the actual reported cash amount. Do not invent a fee or change the
    // reported execution price to force a rounded statement to reconcile.
    const delta=new Big(row.amount).minus(new Big(row.quantity).times(row.price));
    if(delta.abs().gt('0.01')) return {...row,status:'review' as const,reason:'Reported cash and execution price differ by more than one cent'};
    return {...row,status:'new' as const,reason:'No existing execution matched'};
  });
}
export function matchingDepositRows(events:BrokerExportEvent[], date:string, amount:number) {
  return events.filter(e=>e.kind==='cash'&&e.cashAmount!==null&&new Big(e.cashAmount).gt(0)&&
    new Big(e.cashAmount).eq(amount)&&days(e.postedDate??e.date,date)<=3&&
    (e.broker==='m1'?e.action==='Deposit'||/^ACH deposit of .+ completed\.$/i.test(e.description):e.action==='ACH'));
}
