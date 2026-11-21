import { describe, expect, it } from '@jest/globals';

import { brokerDataSchema, brokerSnapshotSchema, latestSnapshot } from './schema';
const position = {
  securityId: '00000000-0000-4000-8000-000000000001',
  symbol: 'EXAMPLE',
  quantity: '2',
  costBasis: null,
  marketValue: '14.25',
};
const snapshot = {
  id: 'example-statement',
  asOf: '2024-01-31T23:59:59.999Z',
  source: 'synthetic statement',
  currencyCode: 'USD',
  complete: true,
  cash: null,
  totalValue: null,
  positions: [position],
  lots: [],
};
describe('Broker evidence', () => {
  it('keeps a date-only aggregate report separate from position anchors and rejects inconsistent totals', () => {
    const report = {
      id: 'aggregate',
      date: '2026-11-21',
      source: 'Owner-reported account total; valuation timestamp not supplied',
      currencyCode: 'USD',
      totalValue: '22343.96',
      cash: '200.02',
      investmentsValue: '22143.94',
      performance: {
        period: 'all',
        startDate: '2022-06-09',
        netCashFlow: '19911.66',
        marketGain: '2232.28',
        dividends: '325.75',
        totalGain: '2558.03',
      },
    };
    const result = brokerDataSchema.parse({
      broker: 'm1',
      accountKey: 'example',
      snapshots: [snapshot],
      accountObservations: [report],
    });
    expect(latestSnapshot(result)?.id).toBe(snapshot.id);
    expect(() =>
      brokerDataSchema.parse({ ...result, accountObservations: [{ ...report, totalValue: '22345.36' }] }),
    ).toThrow('Account total');
    expect(() =>
      brokerDataSchema.parse({
        ...result,
        accountObservations: [{ ...report, performance: { ...report.performance, totalGain: '2556.63' } }],
      }),
    ).toThrow('performance');
  });
  it('preserves absent basis and cash as unknown', () => {
    const s = brokerSnapshotSchema.parse(snapshot);
    expect(s.positions[0]!.costBasis).toBeNull();
    expect(s.cash).toBeNull();
  });
  it('rejects repeated security identities in a snapshot', () => {
    expect(() => brokerSnapshotSchema.parse({ ...snapshot, positions: [position, position] })).toThrow();
  });
  it('never uses a future observation for a historical date', () => {
    const data = brokerDataSchema.parse({ broker: 'm1', accountKey: 'example', snapshots: [snapshot] });
    expect(latestSnapshot(data, new Date('2023-12-31'))).toBeUndefined();
    expect(latestSnapshot(data, new Date('2024-02-01'))?.id).toBe('example-statement');
  });
  it('rejects an unreconciled complete account total', () => {
    expect(() => brokerSnapshotSchema.parse({ ...snapshot, cash: '1', totalValue: '99' })).toThrow('reconcile');
    expect(brokerSnapshotSchema.parse({ ...snapshot, cash: '1', totalValue: '15.25' }).totalValue).toBe('15.25');
  });
});
