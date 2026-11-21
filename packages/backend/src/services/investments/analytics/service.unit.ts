jest.mock('@models/investments/portfolios.model', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('@models/investments/broker-portfolio-data.model', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('@models/investments/investment-transaction.model', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('@models/investments/portfolio-balances.model', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('@models/investments/portfolio-transfers.model', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('@models/investments/securities.model', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('@models/investments/security-pricing.model', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('@models/users-currencies.model', () => ({
  getCurrency: jest.fn().mockResolvedValue({ currency: { code: 'USD' } }),
}));
jest.mock('@services/investments/holdings/get-holding-values.service', () => ({ getHoldingValues: jest.fn() }));
jest.mock('@services/investments/portfolios/get-portfolio-summary.service', () => ({ getPortfolioSummary: jest.fn() }));
jest.mock('@services/common/with-deduplication', () => ({ withDeduplication: (fn: unknown) => fn }));
jest.mock('@models/user-settings.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue({ settings: { ui: { hiddenPortfolioIds: [] } } }) },
}));
jest.mock('@models/investments/fund-holdings-snapshot.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null) },
}));
jest.mock('@services/investments/composition/service', () => ({
  isFundSecurity: () => false,
  compositionStatuses: () => [],
  getCompositionAttempts: jest.fn().mockResolvedValue([]),
  getCompositionSchedule: jest.fn().mockResolvedValue(null),
}));
jest.mock('./fund-snapshots', () => ({
  getFundSnapshots: jest.fn().mockResolvedValue([]),
  latestFundSnapshots: () => [],
}));
jest.mock('./history', () => ({ buildHistory: jest.fn().mockReturnValue([]) }));

import BrokerPortfolioData from '@models/investments/broker-portfolio-data.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { getHoldingValues } from '@services/investments/holdings/get-holding-values.service';
import { getPortfolioSummary } from '@services/investments/portfolios/get-portfolio-summary.service';

import { buildHistory } from './history';
import { assertOwnedSelection, getInvestmentAnalytics, visiblePortfolioSelection } from './service';

const portfolios = [
  { id: 'a', name: 'Taxable', portfolioType: 'investment', isEnabled: false },
  { id: 'b', name: 'Roth', portfolioType: 'retirement', isEnabled: true },
];
const security = {
  id: 'security',
  symbol: 'SAME',
  providerSymbol: 'SAME',
  name: 'Company',
  assetClass: 'stocks',
  currencyCode: 'USD',
  providerName: 'yahoo',
  exchangeMic: 'XNAS',
};
const holding = (portfolioId: string, quantity: string, costBasis: string, marketValue: string) => ({
  portfolioId,
  securityId: 'security',
  quantity,
  costBasis,
  refCostBasis: costBasis,
  marketValue,
  refMarketValue: marketValue,
  currencyCode: 'USD',
  security,
  latestPrice: '100',
  priceDate: new Date('2026-11-19'),
  costBasisKnown: true,
  marketValueKnown: true,
  realizedGainKnown: true,
  realizedGainValue: '1',
  excluded: false,
});
const summary = (id: string) => ({
  portfolioId: id,
  portfolioName: id,
  totalPortfolioValueInBaseCurrency: id === 'a' ? '30' : '75',
  totalCashInBaseCurrency: id === 'a' ? '5' : '0',
  totalPortfolioValue: id === 'a' ? '30' : '75',
  currencyCode: 'USD',
  baseCurrencyCode: 'USD',
  marketValueKnown: true,
  cashKnown: true,
  realizedGainKnown: true,
  realizedGainValue: id === 'a' ? '9' : '2',
});
describe('owner-scoped native portfolio analytics adapter', () => {
  it('excludes hidden portfolios even when explicitly selected without treating net-worth exclusion as visibility', () => {
    expect(visiblePortfolioSelection(undefined, ['a', 'b'], ['b'])).toEqual(['a']);
    expect(visiblePortfolioSelection(['b'], ['a', 'b'], ['b'])).toEqual([]);
    expect(() => visiblePortfolioSelection(['foreign'], ['a', 'b'], ['foreign'])).toThrow();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(buildHistory).mockReturnValue([]);
    jest.mocked(Portfolios.findAll).mockResolvedValue(portfolios as never);
    for (const model of [
      BrokerPortfolioData,
      InvestmentTransaction,
      PortfolioBalances,
      PortfolioTransfers,
      Securities,
      SecurityPricing,
    ])
      jest.mocked(model.findAll).mockResolvedValue([]);
    jest
      .mocked(getHoldingValues)
      .mockImplementation(
        async ({ portfolioId }) =>
          [
            holding(
              portfolioId,
              portfolioId === 'a' ? '0.25' : '0.75',
              portfolioId === 'a' ? '10' : '60',
              portfolioId === 'a' ? '25' : '75',
            ),
          ] as never,
      );
    jest.mocked(getPortfolioSummary).mockImplementation(async ({ portfolioId }) => summary(portfolioId) as never);
  });
  it('aggregates existing native outputs including hidden portfolios without averaging average costs or adding bank balances', async () => {
    const result = await getInvestmentAnalytics({ userId: 1 });
    expect(result.selectedPortfolioIds).toEqual(['a', 'b']);
    expect(result.metrics.marketValue?.value).toBe('105');
    expect(result.holdings[0]?.quantity).toBe('1');
    expect(result.holdings[0]?.costBasis).toBe('70');
    expect(result.holdings[0]?.averageCost).toBe('70');
    expect(result.holdings[0]?.accounts).toHaveLength(2);
    expect(result.metrics.realizedGain?.value).toBe('11'); // Includes native summary's closed-position gains.
    expect(getPortfolioSummary).toHaveBeenCalledTimes(2);
    expect(getHoldingValues).toHaveBeenCalledTimes(2);
  });
  it('withholds incomplete totals but exposes explicit known partial subtotals and leaves native source records alone', async () => {
    jest
      .mocked(getPortfolioSummary)
      .mockImplementation(
        async ({ portfolioId }) =>
          ({ ...summary(portfolioId), cashKnown: portfolioId !== 'b', marketValueKnown: portfolioId !== 'b' }) as never,
      );
    const result = await getInvestmentAnalytics({ userId: 1 });
    expect(result.metrics.marketValue?.value).toBeNull();
    expect(result.metrics.knownMarketValue).toMatchObject({ value: '105', status: 'partial' });
    expect(result.metrics.unknownCashCount?.value).toBe('1');
    expect(result.holdings[0]?.weight).toBe('95.238095');
  });
  it('rejects foreign portfolio selections before fetching holdings or financial data', async () => {
    await expect(getInvestmentAnalytics({ userId: 1, portfolioIds: ['foreign'] })).rejects.toThrow('unavailable');
    expect(getPortfolioSummary).not.toHaveBeenCalled();
    expect(InvestmentTransaction.findAll).not.toHaveBeenCalled();
    expect(assertOwnedSelection(['a', 'a'], ['a', 'b'])).toEqual(['a']);
  });
  it('retains actual fund wrappers in direct holdings when look-through composition is unavailable', async () => {
    jest.mocked(getHoldingValues).mockImplementation(
      async ({ portfolioId }) =>
        [
          {
            ...holding(
              portfolioId,
              portfolioId === 'a' ? '0.25' : '0.75',
              portfolioId === 'a' ? '10' : '60',
              portfolioId === 'a' ? '25' : '75',
            ),
            security: { ...security, name: 'Example Index Fund' },
          },
        ] as never,
    );
    const result = await getInvestmentAnalytics({ userId: 1 });
    expect(result.holdings[0]).toMatchObject({ symbol: 'SAME', isFund: true });
    expect(result.allocations.holdings?.find((r) => r.key === 'security')?.label).toBe('SAME');
    expect(result.allocations.underlying?.some((r) => r.label.includes('Unknown holdings'))).toBe(true);
    expect(result.exposure.some((r) => r.id === 'security')).toBe(false);
  });
  it('recognizes explicit total-market-index fund names while retaining the actual FSKAX direct ticker', async () => {
    jest.mocked(getHoldingValues).mockImplementation(
      async ({ portfolioId }) =>
        [
          {
            ...holding(
              portfolioId,
              portfolioId === 'a' ? '0.25' : '0.75',
              portfolioId === 'a' ? '10' : '60',
              portfolioId === 'a' ? '25' : '75',
            ),
            security: { ...security, symbol: 'FSKAX', providerSymbol: 'FSKAX', name: 'Fidelity Total Market Index' },
          },
        ] as never,
    );
    const result = await getInvestmentAnalytics({ userId: 1 });
    expect(result.holdings[0]).toMatchObject({ symbol: 'FSKAX', isFund: true });
    expect(result.allocations.holdings?.find((r) => r.key === 'security')?.label).toBe('FSKAX');
    expect(result.exposure.find((r) => r.id === 'unknown:security')).toMatchObject({
      unknown: true,
      totalValue: '100',
    });
    expect(result.exposure.some((r) => r.id === 'security')).toBe(false);
    expect(result.health.find((r) => r.id === 'fund-classification:security')?.status).toBe('partial');
  });
  it('preserves the complete available MAX range when only partial portfolio observations exist', async () => {
    jest.mocked(buildHistory).mockReturnValue([
      { date: '2019-12-12', marketValue: null, portfolios: { a: '100', b: null }, coverage: 50 },
      { date: '2026-11-20', marketValue: null, portfolios: { a: null, b: '200' }, coverage: 50 },
    ] as never);
    const result = await getInvestmentAnalytics({ userId: 1 });
    expect(result.coverage.historyStart).toBe('2019-12-12');
    expect(result.coverage.historyEnd).toBe('2026-11-20');
    expect(result.history).toHaveLength(2);
    expect(result.history[0]?.marketValue).toBeNull();
    expect(result.history.at(-1)?.marketValue).toBe(result.metrics.marketValue?.value);
    expect(result.history[0]?.portfolios.a).toBe('100');
  });
});
