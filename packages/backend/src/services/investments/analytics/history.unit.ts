import type BrokerPortfolioData from '@models/investments/broker-portfolio-data.model';
import type SecurityPricing from '@models/investments/security-pricing.model';

import { buildHistory } from './history';

describe('native historical valuation adapter', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-20T12:00:00Z'));
  });
  afterAll(() => {
    jest.useRealTimers();
  });
  it('uses real recorded dates for incomplete imports and never copies current prices into unsupported dates', () => {
    const broker = {
      portfolioId: 'a',
      data: {
        historyComplete: false,
        snapshots: [
          { asOf: '2026-11-18T12:00:00Z', complete: true, totalValue: '123.456', currencyCode: 'USD' },
          { asOf: '2026-11-20T12:00:00Z', complete: true, totalValue: '150', currencyCode: 'USD' },
        ],
      },
    } as unknown as BrokerPortfolioData;
    const points = buildHistory({
      ids: ['a'],
      currencyCode: 'USD',
      brokers: [broker],
      transactions: [],
      transfers: [],
      balances: [],
      securities: [],
      prices: [],
    });
    expect(points.map((p) => [p.date, p.marketValue])).toEqual([
      ['2026-11-18', '123.456'],
      ['2026-11-19', null],
      ['2026-11-20', '150'],
    ]);
    expect(points.every((p) => p.netInvested === null && p.returnPercent === null)).toBe(true);
  });
  it('never treats missing historical prices as verified cost-basis market values', () => {
    const points = buildHistory({
      ids: ['a'],
      currencyCode: 'USD',
      brokers: [],
      transactions: [
        {
          portfolioId: 'a',
          securityId: 's',
          category: 'buy',
          date: new Date('2026-11-18'),
          quantity: '1',
          refAmount: '100',
          currencyCode: 'USD',
          settlementCurrencyCode: 'USD',
          settlementAmount: '100',
        },
      ] as never,
      transfers: [],
      balances: [],
      securities: [{ id: 's', assetClass: 'stocks', currencyCode: 'USD' }] as never,
      prices: [{ securityId: 's', date: new Date('2026-11-20'), priceClose: '120' }] as unknown as SecurityPricing[],
    });
    expect(points[0]?.marketValue).toBeNull();
    expect(points[1]?.marketValue).toBeNull();
    // The existing native replay is used when an actual price exists.
    expect(points[2]?.marketValue).not.toBeNull();
  });
  it('shows supported securities after a real position anchor without fabricating earlier positions or cash', () => {
    const points = buildHistory({
      ids: ['a'],
      currencyCode: 'USD',
      brokers: [
        {
          portfolioId: 'a',
          data: {
            historyComplete: false,
            snapshots: [
              {
                asOf: '2026-11-18T00:00:00Z',
                complete: true,
                currencyCode: 'USD',
                cash: null,
                totalValue: null,
                positions: [{ securityId: 's', quantity: '2', costBasis: '100', marketValue: null }],
              },
            ],
          },
        },
      ] as never,
      transactions: [],
      transfers: [],
      balances: [],
      securities: [{ id: 's', currencyCode: 'USD', assetClass: 'stocks' }] as never,
      prices: [
        { securityId: 's', date: new Date('2026-11-18'), priceClose: '80' },
        { securityId: 's', date: new Date('2026-11-20'), priceClose: '90' },
      ] as never,
    });
    expect(points.every((p) => p.marketValue === null)).toBe(true);
    expect(points.at(-1)?.knownPortfolios?.a).toBe('180');
    expect(points.at(-1)?.netInvested).toBeNull();
  });
});
