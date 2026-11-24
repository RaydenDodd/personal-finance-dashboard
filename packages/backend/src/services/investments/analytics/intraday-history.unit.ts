import { buildHistory } from './history';
describe('intraday native replay', () => {
  it('retains individual observed quote times instead of collapsing them to one date', () => {
    const times = ['2026-11-23T14:34:59.999Z', '2026-11-23T14:39:59.999Z'];
    const rows = buildHistory({
      ids: ['a'],
      currencyCode: 'USD',
      brokers: [],
      balances: [],
      transfers: [],
      transactions: [
        {
          portfolioId: 'a',
          securityId: 's',
          date: new Date('2026-11-23T14:00:00Z'),
          category: 'buy',
          quantity: '2',
          refAmount: '20',
          currencyCode: 'USD',
        },
      ] as never,
      securities: [{ id: 's', currencyCode: 'USD', assetClass: 'stocks' }] as never,
      prices: [
        {
          securityId: 's',
          date: new Date('2026-11-23T14:30:00Z'),
          priceAsOf: new Date('2026-11-23T14:30:00Z'),
          priceClose: '10',
        },
        {
          securityId: 's',
          date: new Date('2026-11-23T14:35:00Z'),
          priceAsOf: new Date('2026-11-23T14:35:00Z'),
          priceClose: '11',
        },
      ] as never,
      from: '2026-11-23',
      through: '2026-11-23',
      sampleTimes: times,
    });
    expect(rows.map((row) => row.date)).toEqual(times);
    expect(rows.map((row) => row.knownMarketValue)).toEqual(['20', '22']);
    expect(rows.every((row) => row.marketValue === null)).toBe(true);
  });
});
