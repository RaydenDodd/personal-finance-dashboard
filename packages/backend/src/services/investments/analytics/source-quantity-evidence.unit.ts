import type { TransactionRow } from '@services/stats/get-combined-balance-history/types';

import type { BrokerData } from '../broker-records/schema';
import { sourceQuantityEvidence } from './source-quantity-evidence';

describe('retained source quantity evidence', () => {
  it('marks an unpaired corporate movement as unknown rather than carrying a phantom holding forward', () => {
    const r = sourceQuantityEvidence('p', data([{ ...row, action: 'SPR', quantity: null }]), securities, []);
    expect(r.rows[0]).toMatchObject({ quantityUnknown: true, category: 'transfer' });
    expect(r.issues[0]?.reason).toContain('post-action');
  });
  const row = { action: 'REC', date: '2021-04-28', symbol: 'VXRT', quantity: '1', sourceRowId: 'a'.repeat(64) };
  const securities = [{ id: 's', symbol: 'VXRT' }];
  const data = (events: object[]) => ({ sourceEvents: events }) as BrokerData;
  it('replays a retained original purchase and its evidenced cancellation without source writes', () => {
    const buy = { ...row, action: 'Buy', kind: 'trade', cashAmount: '-8.12', quantity: '0.026899' };
    const cancel = { ...buy, action: 'BCXL', kind: 'review', sourceRowId: 'b'.repeat(64), cashAmount: '8.12' };
    const source = { ...data([buy, cancel]), broker: 'robinhood' } as BrokerData;
    const before = JSON.stringify(source);
    expect(
      sourceQuantityEvidence('p', source, securities, []).rows.map((r) => ({
        category: r.category,
        quantity: r.quantity,
        amount: r.refAmount,
      })),
    ).toEqual([
      { category: 'buy', quantity: '0.026899', amount: '8.12' },
      { category: 'sell', quantity: '0.026899', amount: '8.12' },
    ]);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('reuses a documented stock receipt without creating a purchase or cash flow', () => {
    expect(sourceQuantityEvidence('p', data([row, row]), securities, []).rows).toMatchObject([
      { category: 'transfer', transactionType: 'income', quantity: '1', refAmount: '0', settlementAmount: '0' },
    ]);
  });
  it('does not apply an already imported source row twice', () => {
    expect(
      sourceQuantityEvidence('p', data([row]), securities, [
        { description: `[broker-row:${row.sourceRowId}]` } as TransactionRow,
      ]).rows,
    ).toHaveLength(0);
  });
  it('does not double published splits or a same-ticker identity exchange', () => {
    expect(
      sourceQuantityEvidence(
        'p',
        data([
          { ...row, action: 'SPR' },
          { ...row, sourceRowId: 'b'.repeat(64), action: 'SXCH' },
          { ...row, sourceRowId: 'c'.repeat(64), action: 'SXCH', quantity: null },
        ]),
        securities,
        [],
      ).rows,
    ).toHaveLength(0);
  });
  it('reports missing delisted identities instead of substituting zero or another ticker', () => {
    const r = sourceQuantityEvidence('p', data([{ ...row, symbol: 'WPG' }]), securities, []);
    expect(r.rows).toHaveLength(0);
    expect(r.issues[0]).toMatchObject({ symbol: 'WPG', date: '2021-04-28' });
  });
});
