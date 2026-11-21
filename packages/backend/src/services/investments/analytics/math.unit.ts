import type { InvestmentHolding, InvestmentFundSnapshot } from '@bt/shared/types/investment-analytics';

import { allocation, externalFlow, fundOverlap, lookThrough, percent, resolveFundIdentities, sum } from './math';
import { consolidatedReturns, normalizeComparableSeries, recordedPriceReturns } from './performance';

const holding = (id: string, value: string, isFund = false): InvestmentHolding => ({
  id,
  securityId: id,
  symbol: id,
  name: id,
  currencyCode: 'USD',
  exchange: 'XNAS',
  securityType: 'stocks',
  quantity: '1',
  averageCost: '1',
  costBasis: '1',
  price: value,
  priceDate: '2026-01-01',
  marketValue: value,
  unrealizedGain: null,
  unrealizedPercent: null,
  realizedGain: null,
  dividends: null,
  dailyChange: null,
  dailyChangePercent: null,
  weight: null,
  portfolioCount: 1,
  isFund,
  quality: 'verified',
  accounts: [
    {
      portfolioId: 'account',
      portfolioName: 'Account',
      quantity: '1',
      costBasis: '1',
      averageCost: '1',
      marketValue: value,
      unrealizedGain: null,
      source: 'fixture',
      updatedAt: '2026-01-01',
    },
  ],
});
const snapshot = (id: string, holdings: InvestmentFundSnapshot['holdings']): InvestmentFundSnapshot => ({
  fundId: id,
  symbol: id,
  asOf: '2026-01-01',
  provider: 'fixture',
  retrievedAt: '2026-01-01T00:00:00Z',
  coverage: sum(holdings.map((h) => h.weight))!,
  holdings,
});
describe('consolidated financial arithmetic', () => {
  it('fills absent classifications from identified constituent evidence while retaining genuine conflicts', () => {
    const direct = { ...holding('AAPL', '100'), country: 'Unknown', sector: 'Unknown' };
    const rows = lookThrough(
      [direct, holding('FUND', '100', true)],
      [
        snapshot('FUND', [
          {
            id: 'AAPL',
            symbol: 'AAPL',
            name: 'Apple',
            weight: '100',
            country: 'US',
            sector: 'Information Technology',
            classificationStandard: 'GICS',
          },
        ]),
      ],
      '200',
    );
    expect(rows[0]?.country).toBe('US');
    expect(rows[0]?.sector).toBe('GICS · Information Technology');
  });
  it('retains fractional and cryptocurrency decimal precision; unavailable never becomes zero', () => {
    expect(sum(['0.000000000000000001', '0.000000000000000002'])).toBe('3e-18');
    expect(sum(['10', null])).toBeNull();
    expect(sum([])).toBe('0');
    expect(percent('12.4', '100')).toBe('12.400000');
    expect(percent('1', '0')).toBeNull();
  });
  it('excludes internal movements but handles external-to-selection transfers and adjustments', () => {
    const transfer = { fromPortfolioId: 'a', toPortfolioId: 'b', refAmount: '100', refToAmount: '99' };
    expect(externalFlow(transfer, new Set(['a', 'b']))).toBe('0');
    expect(externalFlow(transfer, new Set(['a']))).toBe('-100');
    expect(externalFlow(transfer, new Set(['b']))).toBe('99');
    expect(externalFlow({ ...transfer, isAdjustment: true }, new Set(['b']))).toBe('0');
  });
  it('combines direct+indirect exposure without counting fund wrappers or normalizing partial weights', () => {
    const rows = lookThrough(
      [holding('FUND1', '50000', true), holding('FUND2', '30000', true), holding('NVDA', '5000')],
      [
        snapshot('FUND1', [{ id: 'NVDA', symbol: 'NVDA', name: 'Nvidia', weight: '10' }]),
        snapshot('FUND2', [{ id: 'NVDA', symbol: 'NVDA', name: 'Nvidia', weight: '8' }]),
      ],
      '100000',
    );
    const nvda = rows.find((r) => r.id === 'NVDA')!;
    expect(nvda.directValue).toBe('5000');
    expect(nvda.indirectValue).toBe('7400');
    expect(nvda.totalValue).toBe('12400');
    expect(nvda.weight).toBe('12.400000');
    expect(nvda.fundCount).toBe(2);
    expect(sum(rows.map((r) => r.totalValue))).toBe('85000');
    expect(rows.filter((r) => r.unknown)).toHaveLength(2);
    expect(rows.some((r) => r.id === 'FUND1')).toBe(false);
  });
  it('expands recursive funds and terminates circular compositions preserving unknown value', () => {
    const recursive = [
      snapshot('A', [{ id: 'B', symbol: 'B', name: 'B', weight: '50', isFund: true }]),
      snapshot('B', [{ id: 'C', symbol: 'C', name: 'Company', weight: '40' }]),
    ];
    const rows = lookThrough([holding('A', '1000', true)], recursive, '1000');
    expect(rows.find((r) => r.id === 'C')?.totalValue).toBe('200');
    expect(sum(rows.map((r) => r.totalValue))).toBe('1000');
    const cycle = lookThrough(
      [holding('A', '1000', true)],
      [
        snapshot('A', [{ id: 'B', symbol: 'B', name: 'B', weight: '100', isFund: true }]),
        snapshot('B', [{ id: 'A', symbol: 'A', name: 'A', weight: '100', isFund: true }]),
      ],
      '1000',
    );
    expect(cycle).toHaveLength(1);
    expect(cycle[0]?.unknown).toBe(true);
    expect(cycle[0]?.totalValue).toBe('1000');
  });
  it('uses min comparable weights for overlap; ticker collisions remain separate identities', () => {
    const sources = [
      snapshot('A', [
        { id: 'US:1', symbol: 'SAME', name: 'US', weight: '10' },
        { id: 'X', symbol: 'X', name: 'X', weight: '30' },
      ]),
      snapshot('B', [
        { id: 'CA:2', symbol: 'SAME', name: 'CA', weight: '20' },
        { id: 'X', symbol: 'X', name: 'X', weight: '8' },
      ]),
    ];
    const overlap = fundOverlap(sources, [holding('A', '100', true), holding('B', '200', true)])[0]!;
    expect(overlap.weightedOverlap).toBe('8');
    expect(overlap.sharedCount).toBe(1);
    expect(overlap.coverage).toBe('partial');
    expect(overlap.shared[0]?.combinedValue).toBe('46');
  });
  it('reports unique companies and exact sector and issuer-country overlap on complete compositions', () => {
    const a = {
      ...snapshot('A', [
        { id: 'X', symbol: 'X', name: 'Shared company', weight: '50', sector: 'Technology', country: 'US' },
        { id: 'L', symbol: 'L', name: 'Left company', weight: '50', sector: 'Healthcare', country: 'CA' },
      ]),
      classificationStandard: 'GICS',
    };
    const b = {
      ...snapshot('B', [
        { id: 'X', symbol: 'X', name: 'Shared company', weight: '50', sector: 'Technology', country: 'USA' },
        { id: 'R', symbol: 'R', name: 'Right company', weight: '50', sector: 'Financials', country: 'GB' },
      ]),
      classificationStandard: 'GICS',
    };
    const result = fundOverlap([a, b], [holding('A', '1000', true), holding('B', '2000', true)])[0]!;
    expect(result.leftUnique).toEqual([{ id: 'L', symbol: 'L', name: 'Left company', weight: '50', value: '500' }]);
    expect(result.rightUnique).toEqual([{ id: 'R', symbol: 'R', name: 'Right company', weight: '50', value: '1000' }]);
    expect(result.shared[0]?.combinedValue).toBe('1500');
    expect(result.sectorOverlap).toMatchObject({
      weightedOverlap: '50',
      status: 'verified',
      leftCoverage: '100',
      rightCoverage: '100',
    });
    expect(result.sectorOverlap.categories.find((row) => row.label === 'GICS · Technology')).toMatchObject({
      leftWeight: '50',
      rightWeight: '50',
      overlapWeight: '50',
    });
    expect(result.countryOverlap).toMatchObject({
      weightedOverlap: '50',
      status: 'verified',
      leftCoverage: '100',
      rightCoverage: '100',
    });
    expect(result.countryOverlap.categories.find((row) => row.label === 'US')?.overlapWeight).toBe('50');
  });
  it('excludes unknown classifications from category matches and reports partial coverage without normalizing', () => {
    const a = {
      ...snapshot('A', [
        { id: 'X', symbol: 'X', name: 'Unclassified shared', weight: '40', sector: 'Unknown', country: 'Unknown' },
        { id: 'L', symbol: 'L', name: 'Left', weight: '20', sector: 'Technology', country: 'US' },
      ]),
      classificationStandard: 'GICS',
    };
    const b = {
      ...snapshot('B', [
        { id: 'X', symbol: 'X', name: 'Unclassified shared', weight: '50', sector: 'N/A', country: 'Other' },
        { id: 'R', symbol: 'R', name: 'Right', weight: '30', sector: 'Technology', country: 'US' },
      ]),
      classificationStandard: 'GICS',
    };
    const result = fundOverlap([a, b], [holding('A', '100', true), holding('B', '100', true)])[0]!;
    expect(result.weightedOverlap).toBe('40');
    expect(result.coverage).toBe('partial');
    expect(result.sectorOverlap).toMatchObject({
      weightedOverlap: '20',
      status: 'partial',
      leftCoverage: '20',
      rightCoverage: '30',
    });
    expect(result.countryOverlap).toMatchObject({
      weightedOverlap: '20',
      status: 'partial',
      leftCoverage: '20',
      rightCoverage: '30',
    });
    expect(result.sectorOverlap.categories.some((row) => /unknown/i.test(row.label))).toBe(false);
    expect(result.countryOverlap.categories.some((row) => /unknown/i.test(row.label))).toBe(false);
  });
  it('withholds incompatible or unspecified sector taxonomies rather than reporting a false zero overlap', () => {
    const row = { id: 'X', symbol: 'X', name: 'Shared', weight: '100', sector: 'Technology', country: 'US' };
    const a = { ...snapshot('A', [row]), classificationStandard: 'GICS' };
    const b = { ...snapshot('B', [row]), classificationStandard: 'ICB' };
    const result = fundOverlap([a, b], [holding('A', '100', true), holding('B', '100', true)])[0]!;
    expect(result.weightedOverlap).toBe('100');
    expect(result.sectorOverlap).toMatchObject({
      weightedOverlap: null,
      status: 'unavailable',
      leftCoverage: '0',
      rightCoverage: '0',
    });
    expect(result.sectorOverlap.reason).toContain('incompatible');
    expect(result.countryOverlap.weightedOverlap).toBe('100');
    const unspecified = fundOverlap(
      [snapshot('A', [row]), snapshot('B', [row])],
      [holding('A', '100', true), holding('B', '100', true)],
    )[0]!;
    expect(unspecified.sectorOverlap.weightedOverlap).toBeNull();
    expect(unspecified.sectorOverlap.status).toBe('unavailable');
  });
  it('normalizes English issuer-country names to two-letter codes and leaves ambiguous names unclassified', () => {
    const result = fundOverlap(
      [
        snapshot('A', [
          { id: 'X', symbol: 'X', name: 'German company', weight: '70', country: 'Germany' },
          { id: 'L', symbol: 'L', name: 'Ambiguous country', weight: '30', country: 'Congo' },
        ]),
        snapshot('B', [
          { id: 'X', symbol: 'X', name: 'German company', weight: '80', country: 'DE' },
          { id: 'R', symbol: 'R', name: 'Ambiguous country', weight: '20', country: 'Congo' },
        ]),
      ],
      [holding('A', '100', true), holding('B', '100', true)],
    )[0]!;
    expect(result.countryOverlap).toMatchObject({
      weightedOverlap: '70',
      status: 'partial',
      leftCoverage: '70',
      rightCoverage: '80',
    });
    expect(result.countryOverlap.categories).toEqual([
      { label: 'DE', leftWeight: '70', rightWeight: '80', overlapWeight: '70' },
    ]);
    const unknown = fundOverlap(
      [
        snapshot('A', [{ id: 'X', symbol: 'X', name: 'Ambiguous', weight: '100', country: 'Congo' }]),
        snapshot('B', [{ id: 'Y', symbol: 'Y', name: 'Ambiguous', weight: '100', country: 'Congo' }]),
      ],
      [holding('A', '100', true), holding('B', '100', true)],
    )[0]!;
    expect(unknown.countryOverlap.weightedOverlap).toBeNull();
    expect(unknown.countryOverlap.reason).toContain('ambiguous');
  });
  it('compares recursively expanded companies, retains cyclic residuals and excludes incompatible nested classifications', () => {
    const snapshots = [
      {
        ...snapshot('A', [
          { id: 'CHILD', symbol: 'CHILD', name: 'Child fund', weight: '40', isFund: true },
          { id: 'X', symbol: 'X', name: 'Company X', weight: '60', sector: 'Technology', country: 'US' },
        ]),
        classificationStandard: 'GICS',
      },
      {
        ...snapshot('CHILD', [
          { id: 'Y', symbol: 'Y', name: 'Company Y', weight: '100', sector: 'Technology', country: 'US' },
        ]),
        classificationStandard: 'ICB',
      },
      {
        ...snapshot('B', [
          { id: 'X', symbol: 'X', name: 'Company X', weight: '100', sector: 'Technology', country: 'US' },
        ]),
        classificationStandard: 'GICS',
      },
    ];
    const result = fundOverlap(snapshots, [holding('A', '100', true), holding('B', '200', true)])[0]!;
    expect(result.weightedOverlap).toBe('60');
    expect(result.shared.map((row) => row.id)).toEqual(['X']);
    expect(result.leftUnique.map((row) => row.id)).toEqual(['Y']);
    expect(result.sectorOverlap).toMatchObject({
      weightedOverlap: '60',
      status: 'partial',
      leftCoverage: '60',
      rightCoverage: '100',
    });
    expect(result.countryOverlap).toMatchObject({ weightedOverlap: '100', status: 'verified' });
    const cyclic = fundOverlap(
      [
        snapshot('A', [{ id: 'A', symbol: 'A', name: 'Cycle', weight: '100', isFund: true }]),
        snapshot('B', [{ id: 'X', symbol: 'X', name: 'Company', weight: '100' }]),
      ],
      [holding('A', '100', true), holding('B', '100', true)],
    )[0]!;
    expect(cyclic.sharedCount).toBe(0);
    expect(cyclic.coverage).toBe('partial');
    expect(cyclic.leftUnique).toEqual([]);
    expect(cyclic.sectorOverlap.status).toBe('unavailable');
  });
  it('keeps dollar exposures null when a required position valuation is missing, without losing composition weights', () => {
    const sources = [
      snapshot('A', [
        { id: 'X', symbol: 'X', name: 'Shared', weight: '50' },
        { id: 'L', symbol: 'L', name: 'Unique left', weight: '50' },
      ]),
      snapshot('B', [
        { id: 'X', symbol: 'X', name: 'Shared', weight: '50' },
        { id: 'R', symbol: 'R', name: 'Unique right', weight: '50' },
      ]),
    ];
    const result = fundOverlap(sources, [
      { ...holding('A', '100', true), marketValue: null },
      holding('B', '200', true),
    ])[0]!;
    expect(result.shared[0]?.combinedValue).toBeNull();
    expect(result.weightedOverlap).toBe('50');
    expect(result.leftUnique[0]?.value).toBeNull();
    expect(result.rightUnique[0]?.value).toBe('100');
    const missing = fundOverlap([sources[0]!], [holding('A', '100', true), holding('B', '100', true)])[0]!;
    expect(missing.leftUnique).toEqual([]);
    expect(missing.rightUnique).toEqual([]);
    expect(missing.coverage).toBe('unavailable');
    expect(missing.sectorOverlap.weightedOverlap).toBeNull();
    expect(missing.sectorOverlap.reason).toContain('composition is missing');
  });
  it('retains unknown category allocations and exact category sums', () => {
    const rows = allocation(
      [
        { key: 'Unknown', label: 'Unknown', value: '25.125', id: 'a' },
        { key: 'Unknown', label: 'Unknown', value: '0.875', id: 'b' },
      ],
      '100',
    );
    expect(rows[0]?.value).toBe('26');
    expect(rows[0]?.percent).toBe('26.000000');
    expect(rows[0]?.securityIds).toEqual(['a', 'b']);
  });
  it('combines direct UUID and exact fund ISIN/CUSIP identities while retaining source aliases', () => {
    const inputs = [snapshot('FUND', [{ id: 'ISIN:US67066G1040', symbol: 'NVDA', name: 'Nvidia', weight: '10' }])];
    const resolved = resolveFundIdentities(inputs, [
      { id: 'uuid-nvda', isin: 'US67066G1040', cusip: '67066G104', currencyCode: 'USD', exchangeMic: 'XNAS' },
    ]);
    expect(resolved[0]?.holdings[0]).toMatchObject({ id: 'uuid-nvda', sourceId: 'ISIN:US67066G1040' });
    expect(inputs[0]?.holdings[0]?.id).toBe('ISIN:US67066G1040');
    const exposure = lookThrough([holding('FUND', '1000', true), holding('uuid-nvda', '50')], resolved, '1050');
    expect(exposure.find((e) => e.id === 'uuid-nvda')?.totalValue).toBe('150');
    const ambiguous = resolveFundIdentities(inputs, [
      { id: 'one', isin: 'US67066G1040', currencyCode: 'USD' },
      { id: 'two', isin: 'US67066G1040', currencyCode: 'CAD' },
    ]);
    expect(ambiguous[0]?.holdings[0]?.id).toBe('ISIN:US67066G1040');
  });
});
describe('exact consolidated return and benchmark capability', () => {
  it('derives period price changes from real historical closes and withholds sparse or stale periods', () => {
    const prices = [
      { date: '2025-11-20', price: '50' },
      { date: '2025-12-31', price: '80' },
      { date: '2026-10-20', price: '90' },
      { date: '2026-11-13', price: '100' },
      { date: '2026-11-19', price: '110' },
      { date: '2026-11-20', price: '120' },
    ];
    const result = recordedPriceReturns(prices, new Date('2026-11-20T12:00:00Z'));
    expect(result.weekly).toBe('20.000000');
    expect(result.monthly).toBe('33.333333');
    expect(result.ytd).toBe('50.000000');
    expect(result['1y']).toBe('140.000000');
    expect(recordedPriceReturns(prices.slice(-1), new Date('2026-11-20T12:00:00Z')).monthly).toBeNull();
    expect(recordedPriceReturns(prices, new Date('2026-12-20')).weekly).toBeNull();
  });
  it('chains cash-flow boundary valuations without treating contributions as returns', () => {
    const result = consolidatedReturns(
      [
        { date: '2025-01-01', beforeFlow: '100', afterFlow: '100', externalFlow: '0' },
        { date: '2025-07-01', beforeFlow: '110', afterFlow: '210', externalFlow: '100' },
        { date: '2026-01-01', beforeFlow: '231', afterFlow: '231', externalFlow: '0' },
      ],
      true,
    );
    expect(result.twr).toBe('21.000000');
    expect(result.annualized).toBe('21.000000');
    expect(Number(result.xirr)).toBeGreaterThan(20);
    expect(result.maxDrawdown).toBe('0.000000');
    expect(result.volatility).toBeNull();
  });
  it('handles a withdrawal and a negative drawdown', () => {
    const result = consolidatedReturns(
      [
        { date: '2025-01-01', beforeFlow: '100', afterFlow: '100', externalFlow: '0' },
        { date: '2025-06-01', beforeFlow: '80', afterFlow: '60', externalFlow: '-20' },
        { date: '2026-01-01', beforeFlow: '90', afterFlow: '90', externalFlow: '0' },
      ],
      true,
    );
    expect(result.twr).toBe('20.000000');
    expect(result.maxDrawdown).toBe('-20.000000');
  });
  it('withholds incomplete, unreconciled or missing-boundary returns', () => {
    const points = [
      { date: '2025-01-01', beforeFlow: '100', afterFlow: '100', externalFlow: '0' },
      { date: '2026-01-01', beforeFlow: '110', afterFlow: '200', externalFlow: '100' },
    ];
    expect(consolidatedReturns(points, true).twr).toBeNull();
    expect(consolidatedReturns(points, false).xirr).toBeNull();
    expect(consolidatedReturns([{ ...points[0]!, beforeFlow: null }, points[1]!], true).twr).toBeNull();
  });
  it('normalizes comparable actual dates with a common origin, excluding unmatched dates', () => {
    const result = normalizeComparableSeries([
      {
        id: 'portfolio',
        points: [
          { date: '2025-01-01', value: '100' },
          { date: '2025-02-01', value: '120' },
          { date: '2025-03-01', value: '132' },
        ],
      },
      {
        id: 'index',
        points: [
          { date: '2025-02-01', value: '5000' },
          { date: '2025-03-01', value: '5250' },
        ],
      },
    ]);
    expect(result[0]?.points).toEqual([
      { date: '2025-02-01', returnPercent: '0.000000' },
      { date: '2025-03-01', returnPercent: '10.000000' },
    ]);
    expect(result[1]?.points[1]?.returnPercent).toBe('5.000000');
  });
});
