import { classifyCsvBuys, matchingDepositRows } from './funding-review-csv-model';
import type { BrokerExportEvent } from '@services/import-export/investment-transactions-parser/broker-export-parser';
const base:BrokerExportEvent={sourceRowId:'row1',rowNumber:1,broker:'m1',date:'2026-11-23',kind:'trade',action:'Buy',symbol:'ABC',quantity:'0.5',reportedPrice:'100',cashAmount:'-50',description:'Purchased',issue:null};
const security={id:'s',symbol:'ABC',cusip:null,currency:'USD'};
const native={id:'t',sourceRowId:null,date:'2026-11-23',securityId:'s',symbol:'ABC',action:'Buy' as const,quantity:'0.5',price:'100',amount:'50',currency:'USD'};
const run=(rows:BrokerExportEvent[], existing:Parameters<typeof classifyCsvBuys>[1]=[],anchor:string|null=null)=>classifyCsvBuys(rows,existing,[security],new Set(),anchor,'2026-11-18','2026-11-25');
describe('funding CSV reconciliation',()=>{
  it('matches overlapping legacy and stable broker rows without replay',()=>{
    expect(run([base],[native])[0]).toMatchObject({status:'existing',tradeId:'t'});
    expect(run([base],[{...native,sourceRowId:'row1'}])[0]).toMatchObject({status:'existing',tradeId:'t'});
  });
  it('does not collapse repeated purchases onto one existing execution',()=>{
    expect(run([base,{...base,sourceRowId:'row2'}],[native]).map(x=>x.status)).toEqual(['review','review']);
  });
  it('distinguishes new buys from snapshot-covered and rounded-conflicting executions',()=>{
    expect(run([base])[0]!.status).toBe('new');
    expect(run([base],[],'2026-11-24')[0]!.status).toBe('review');
    expect(run([{...base,cashAmount:'-49.90'}])[0]!.status).toBe('review');
    expect(run([{...base,cashAmount:'-49.99'}])[0]!.status).toBe('new');
  });
  it('preserves identical legitimate deposit occurrences',()=>{
    const deposit={...base,kind:'cash' as const,action:'TRANSFER',cashAmount:'200',description:'ACH deposit of $200 completed.',date:'2026-11-21'};
    expect(matchingDepositRows([deposit,{...deposit,sourceRowId:'row2'}],'2026-11-21',200)).toHaveLength(2);
  });
});
