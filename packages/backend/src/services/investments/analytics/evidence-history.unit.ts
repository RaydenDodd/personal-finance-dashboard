import type { TransactionRow } from '@services/stats/get-combined-balance-history/types';

import { buildHistory } from './history';
const tx = (securityId: string, date: string, category: 'buy' | 'sell', quantity: string): TransactionRow =>
  ({
    portfolioId: 'p',
    securityId,
    date: new Date(date + 'T00:00:00Z'),
    category,
    quantity,
    refAmount: '100',
    currencyCode: 'USD',
    settlementCurrencyCode: 'USD',
    settlementAmount: '100',
  }) as TransactionRow;
const price = (securityId: string, date: string, close: string, raw = close) => ({
  securityId,
  date: new Date(date + 'T00:00:00Z'),
  priceClose: close,
  unadjustedClose: raw,
  source: 'yahoo',
});
const security = (id: string) => ({ id, currencyCode: 'USD', assetClass: 'stocks' });
const run = (extra: Record<string, unknown>) =>
  buildHistory({
    ids: ['p'],
    currencyCode: 'USD',
    brokers: [{ portfolioId: 'p', data: { historyComplete: false, snapshots: [] } }],
    transactions: [],
    transfers: [],
    balances: [],
    securities: [security('a'), security('b')],
    prices: [],
    ...extra,
  } as never);

describe('security evidence rather than account-completeness gates', () => {
  it('does not assume continued ownership after an unresolved corporate share movement', () => {
    const points = run({
      from: '2019-12-12',
      through: '2019-12-13',
      transactions: [
        tx('a', '2019-12-12', 'buy', '2'),
        { ...tx('a', '2019-12-13', 'buy', '0'), category: 'transfer', quantityUnknown: true },
      ],
      prices: [price('a', '2019-12-12', '10'), price('a', '2019-12-13', '11')],
    });
    expect(points[0]?.knownMarketValue).toBe('20');
    expect(points[1]?.knownMarketValue).toBeNull();
  });
  it('keeps a crypto daily bar on its recorded UTC day and handles the 2025 exchange closure', () => {
    const daily = price('a', '2019-12-12', '10');
    expect(
      run({
        from: '2019-12-12',
        through: '2019-12-12',
        securities: [{ ...security('a'), assetClass: 'crypto' }],
        transactions: [tx('a', '2019-12-12', 'buy', '2')],
        prices: [{ ...daily, priceAsOf: daily.date }],
      })[0]?.knownMarketValue,
    ).toBe('20');
    expect(
      run({
        from: '2025-01-09',
        through: '2025-01-09',
        transactions: [tx('a', '2025-01-08', 'buy', '2')],
        prices: [price('a', '2025-01-08', '10')],
      })[0]?.knownMarketValue,
    ).toBe('20');
  });
  it('applies explicitly directed in-kind share transfers without inventing a cash movement', () => {
    const points = run({
      from: '2019-12-12',
      through: '2019-12-13',
      transactions: [
        {
          ...tx('a', '2019-12-12', 'buy', '5'),
          category: 'transfer',
          transactionType: 'income',
          refAmount: '0',
          settlementAmount: '0',
        },
        {
          ...tx('a', '2019-12-13', 'sell', '2'),
          category: 'transfer',
          transactionType: 'expense',
          refAmount: '0',
          settlementAmount: '0',
        },
      ],
      prices: [price('a', '2019-12-12', '10'), price('a', '2019-12-13', '11')],
    });
    expect(points[0]?.knownMarketValue).toBe('50');
    expect(points[1]?.knownMarketValue).toBe('33');
  });
  it('reconstructs 2019 purchases and sold positions even with no complete account snapshot', () => {
    const points = run({
      from: '2019-12-12',
      through: '2019-12-16',
      transactions: [
        tx('a', '2019-12-12', 'buy', '2'),
        tx('b', '2019-12-12', 'buy', '3'),
        tx('a', '2019-12-16', 'sell', '2'),
      ],
      prices: [
        price('a', '2019-12-12', '10'),
        price('b', '2019-12-12', '4'),
        price('a', '2019-12-13', '11'),
        price('b', '2019-12-13', '5'),
        price('b', '2019-12-16', '6'),
      ],
    });
    expect(points[0]?.knownMarketValue).toBe('32');
    expect(points[1]?.knownMarketValue).toBe('37');
    expect(points[2]?.knownMarketValue).toBe('37'); // Weekend: last real Friday closes.
    expect(points.at(-1)?.knownMarketValue).toBe('18'); // Sold A is no longer held.
    expect(points.every((p) => p.marketValue === null)).toBe(true); // Missing cash is not invented zero.
  });
  it('keeps other priced securities when a price or opening quantity is missing', () => {
    const coverage: unknown[] = [];
    const points = run({
      from: '2019-12-12',
      through: '2019-12-12',
      transactions: [tx('a', '2019-12-12', 'buy', '2'), tx('b', '2019-12-12', 'sell', '3')],
      prices: [price('a', '2019-12-12', '10')],
      onCoverage: (r: unknown) => coverage.push(r),
    });
    expect(points[0]?.knownMarketValue).toBe('20');
    expect(coverage[0]).toMatchObject({ priced: 1, unknownQuantities: ['b'], cashKnown: false });
    const missing = run({
      from: '2019-12-12',
      through: '2019-12-12',
      transactions: [tx('a', '2019-12-12', 'buy', '2'), tx('b', '2019-12-12', 'buy', '3')],
      prices: [price('a', '2019-12-12', '10')],
    });
    expect(missing[0]?.knownMarketValue).toBe('20');
  });
  it('merges partial position observations without erasing other established holdings', () => {
    const points = run({
      from: '2019-12-12',
      through: '2019-12-13',
      transactions: [tx('a', '2019-12-12', 'buy', '2'), tx('b', '2019-12-12', 'buy', '3')],
      brokers: [
        {
          portfolioId: 'p',
          data: {
            historyComplete: false,
            snapshots: [
              {
                asOf: '2019-12-13T21:00:00Z',
                complete: false,
                currencyCode: 'USD',
                cash: null,
                totalValue: null,
                positions: [{ securityId: 'a', quantity: '4', costBasis: null, marketValue: null }],
              },
            ],
          },
        },
      ],
      prices: [
        price('a', '2019-12-12', '10'),
        price('b', '2019-12-12', '4'),
        price('a', '2019-12-13', '11'),
        price('b', '2019-12-13', '5'),
      ],
    });
    expect(points.at(-1)?.knownMarketValue).toBe('59');
  });
  it('uses a later position observation to establish quantities backward through a documented sale', () => {
    const points = run({
      from: '2019-12-12',
      through: '2019-12-13',
      transactions: [tx('a', '2019-12-12', 'sell', '2')],
      brokers: [
        {
          portfolioId: 'p',
          data: {
            historyComplete: false,
            snapshots: [
              {
                asOf: '2019-12-13T21:00:00Z',
                complete: false,
                currencyCode: 'USD',
                cash: null,
                totalValue: null,
                positions: [{ securityId: 'a', quantity: '3', costBasis: null, marketValue: null }],
              },
            ],
          },
        },
      ],
      prices: [price('a', '2019-12-12', '10'), price('a', '2019-12-13', '11')],
    });
    expect(points[0]?.knownMarketValue).toBe('30'); // Five before the sale, three after it.
    expect(points[1]?.knownMarketValue).toBe('33');
  });
  it('normalizes published splits without creating a purchase or doubling value', () => {
    const points = run({
      from: '2019-12-12',
      through: '2019-12-13',
      transactions: [tx('a', '2019-12-12', 'buy', '2')],
      prices: [price('a', '2019-12-12', '5', '10'), price('a', '2019-12-13', '6', '6')],
    });
    expect(points[0]?.knownMarketValue).toBe('20');
    expect(points[1]?.knownMarketValue).toBe('24');
  });
  it('does not carry an old price over a missing trading-day observation', () => {
    const points = run({
      from: '2019-12-12',
      through: '2019-12-13',
      transactions: [tx('a', '2019-12-12', 'buy', '2')],
      prices: [price('a', '2019-12-12', '10')],
    });
    expect(points[0]?.knownMarketValue).toBe('20');
    expect(points[1]?.knownMarketValue).toBeNull();
  });
});
