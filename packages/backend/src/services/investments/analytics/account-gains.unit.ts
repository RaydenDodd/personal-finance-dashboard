import type { InvestmentPortfolio, InvestmentMetric } from '@bt/shared/types/investment-analytics';
import type { FinanceAccount, FinanceCashFlow } from '@services/personal-finance/types';

import { brokerDataSchema } from '../broker-records/schema';
import { reconcileAccountGains, type GainInput } from './account-gains';

const portfolio = (name = 'Fidelity LongTerm'): InvestmentPortfolio => ({
  id: name,
  name,
  broker: 'fidelity',
  accountType: 'investment',
  isEnabled: true,
  historyComplete: false,
  currencyCode: 'USD',
  marketValue: null,
  cash: null,
  costBasis: '900',
  unrealizedGain: '100',
  realizedGain: null,
  observationDate: null,
  review: [],
  calculation: {
    securitiesValue: '1000',
    pricedValue: '1000',
    gainValue: '1000',
    gainBasis: '900',
    unrealizedGain: '100',
    recordedFunding: null,
    holdingsLessRecordedFunding: null,
    accountGain: null,
    dailyChange: '10',
    missing: ['Lifetime funding: incomplete', 'Cash balance: missing'],
  },
});
const account = (name = 'Fidelitly LongTerm'): FinanceAccount => ({
  id: 'pf' + name,
  userId: 1,
  name,
  currencyCode: 'USD',
  categoryId: 'investments',
  included: true,
  balanceKind: 'asset',
  nativeAccountId: null,
  nativeAccountIds: [],
  preferredSource: 'manual',
  description: '',
  createdAt: '',
});
const opening = (a: FinanceAccount, amount = 837.5): FinanceCashFlow => ({
  id: 'opening' + a.id,
  accountId: a.id,
  date: '2022-01-01',
  amount,
  type: 'contribution',
  opening: true,
  toAccountId: null,
  description: 'Verified principal',
  createdAt: '2022-01-01',
  verified: true,
  source: 'manual',
  evidence: { ownerAccepted: true },
});
const input = (p = portfolio(), a = account()): GainInput => ({
  portfolios: [p],
  allPortfolioNames: [p.name],
  metrics: {} as Record<string, InvestmentMetric>,
  sources: { accounts: [a], flows: [opening(a)], valuations: [] },
  today: '2026-11-21',
  funding: new Map(),
  trades: [],
});

describe('reconciled account gains', () => {
  it('separates reported M1 Pie performance, verified bank funding and the unreconciled cash ledger', () => {
    const p = portfolio('M1 Investments'),
      a = account('M1 Investments'),
      x = input(p, a);
    const dep = 'a'.repeat(64),
      ret = 'b'.repeat(64),
      sha = 'd'.repeat(64);
    const observation = {
      id: 'owner-report',
      date: '2026-11-21',
      source: 'Owner-reported M1 ALL screenshot; quote time not supplied',
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
    x.brokers = [
      {
        portfolioId: p.id,
        data: brokerDataSchema.parse({
          broker: 'm1',
          accountKey: 'example',
          historyComplete: false,
          documents: [{ name: 'activity.csv', sha256: sha }],
          fundingCoverage: {
            from: '2022-06-09',
            through: '2026-11-21',
            sourceRowIds: [dep, ret],
            netContributions: '19787.33',
            documentSha256: sha,
            verified: true,
          },
          accountObservations: [observation],
        }),
      },
    ];
    x.funding.set(p.id, [
      { id: 'd', date: '2022-06-09', amount: '19975.33', source: 'csv', description: `[broker-row:${dep}] deposits` },
      {
        id: 'r',
        date: '2024-11-19',
        amount: '-188',
        source: 'csv',
        description: `[broker-row:${ret}] returned deposit`,
      },
    ]);
    x.sources.valuations = [
      {
        portfolioId: p.id,
        accountId: 'reported',
        name: p.name,
        date: '2026-11-21',
        value: '22343.96',
        cash: '200.02',
        source: observation.source,
      },
    ];
    x.operatingCash = new Map([
      [
        p.id,
        [
          {
            id: 'fees-and-other-cash',
            date: '2026-11-20',
            amount: '-32.22',
            source: 'csv',
            description: 'Net operating cash',
          },
        ],
      ],
    ]);
    x.trades = [
      { portfolioId: p.id, category: 'buy', amount: '20111.99' },
      { portfolioId: p.id, category: 'sell', amount: '221.03' },
      { portfolioId: p.id, category: 'dividend', amount: '331.75' },
    ];
    reconcileAccountGains(x);
    expect(p.calculation).toMatchObject({
      principal: '19787.33',
      accountGain: '2556.63',
      estimated: false,
      principalDifference: '0',
      brokerReconciliation: {
        netSecurityFlow: '19890.96',
        bookCash: '195.9',
        cashDifference: '4.12',
        dividendDifference: '-6',
        securityFlowDifference: '20.7',
        gainDifference: '1.4',
        reportedTotalGain: '2558.03',
      },
    });
    expect(p.cash).toBe('200.02');
    expect(p.unrealizedGain).toBe('100');
    expect(p.historyComplete).toBe(false);
  });
  it('uses verified lifetime principal despite incomplete trade history or absent cash detail', () => {
    const x = input();
    reconcileAccountGains(x);
    expect(x.portfolios[0]!.calculation!.accountGain).toBe('162.5');
    expect(x.metrics.accountGain!.estimated).toBe(true);
    expect(x.metrics.netInvested!.value).toBe('837.5');
  });
  it('uses a reported total without a cash snapshot and adjusts consecutive daily values for external funding', () => {
    const a = account();
    a.nativeAccountIds = ['native'];
    const x = input(portfolio(), a);
    x.sources.valuations = [
      { accountId: 'native', name: 'Fidelity LongTerm', date: '2026-11-19', value: '1000', source: 'provider' },
      { accountId: 'native', name: 'Fidelity LongTerm', date: '2026-11-20', value: '1110', source: 'provider' },
    ];
    x.funding.set(x.portfolios[0]!.id, [
      { id: 'deposit', date: '2026-11-20', amount: '100', source: 'csv', description: 'Actual deposit' },
    ]);
    reconcileAccountGains(x);
    expect(x.portfolios[0]!.calculation!.accountGain).toBe('272.5');
    expect(x.metrics.dailyChange!.value).toBe('10');
    expect(x.portfolios[0]!.calculation!.daily!.estimated).toBe(false);
  });
  it('preserves returned deposits and distinct equal deposits, deduplicating only identical source references', () => {
    const x = input();
    const row = (id: string, amount: string, ref: string) => ({
      id,
      date: '2026-11-20',
      amount,
      source: 'csv',
      description: `[broker-row:${ref}]`,
    });
    x.funding.set(x.portfolios[0]!.id, [
      row('a', '188', 'a'),
      row('duplicate', '188', 'a'),
      row('return', '-188', 'return'),
      row('later', '188', 'later'),
    ]);
    reconcileAccountGains(x);
    expect(x.portfolios[0]!.calculation!.recordedFunding).toBe('188');
    expect(x.portfolios[0]!.calculation!.fundingRecords!.filter((r) => r.excluded)).toHaveLength(1);
  });
  it('keeps crypto buys and recycled sale proceeds separate from deposits and principal', () => {
    const x = input(portfolio('Robinhood Crypto'));
    x.trades = [
      { portfolioId: 'Robinhood Crypto', category: 'buy', amount: '1200' },
      { portfolioId: 'Robinhood Crypto', category: 'sell', amount: '300' },
    ];
    reconcileAccountGains(x);
    expect(x.portfolios[0]!.calculation!.accountGain).toBe('100');
    expect(x.portfolios[0]!.calculation!.purchaseCostEstimate!.netTradingCapital).toBe('900');
    expect(x.portfolios[0]!.calculation!.principal).toBeNull();
    expect(x.portfolios[0]!.calculation!.importedDeposits).toBe('0');
  });
  it('does not apply the combined M1 value when any component is hidden or unselected', () => {
    const x = input(portfolio('M1 Investments'), account('M1 Investments'));
    x.allPortfolioNames.push('M1 Roth IRA');
    x.sources.valuations = [
      { accountId: 'm1', name: 'M1 Total', date: '2026-11-20', value: '5000', source: 'provider' },
    ];
    expect(reconcileAccountGains(x)).toEqual([]);
    expect(x.metrics.marketValue!.value).toBe('1000');
  });
  it('does not treat a linked cash-only account as the whole Public portfolio', () => {
    const a = account('Public');
    a.nativeAccountIds = ['public'];
    const p = portfolio('Public');
    p.cash = '0.74';
    p.marketValue = '1000.74';
    const x = input(p, a);
    x.sources.valuations = [
      { accountId: 'public', name: 'Public', date: '2026-11-20', value: '0.74', source: 'simplefin' },
    ];
    reconcileAccountGains(x);
    expect(p.marketValue).toBe('1000.74');
    expect(p.calculation!.daily!.estimated).toBe(true);
  });
  it('does not turn an aggregate principal correction into a daily deposit', () => {
    const a = account();
    a.nativeAccountIds = ['native'];
    const x = input(portfolio(), a);
    x.sources.flows.push({
      ...opening(a, 100),
      id: 'correction',
      opening: false,
      date: '2026-11-20',
      type: 'adjustment',
    });
    x.sources.valuations = [
      { accountId: 'native', name: a.name, date: '2026-11-19', value: '1000', source: 'provider' },
      { accountId: 'native', name: a.name, date: '2026-11-20', value: '1010', source: 'provider' },
    ];
    reconcileAccountGains(x);
    expect(x.metrics.dailyChange!.value).toBe('10');
    expect(x.portfolios[0]!.calculation!.principal).toBe('937.5');
  });
  it('preserves an entirely unpriced position as missing rather than zero', () => {
    const x = input();
    Object.assign(x.portfolios[0]!.calculation!, { securitiesValue: null, pricedValue: '0' });
    reconcileAccountGains(x);
    expect(x.portfolios[0]!.marketValue).toBeNull();
    expect(x.portfolios[0]!.calculation!.accountGain).toBeNull();
  });
  it('shows an older combined report without replacing current values with it', () => {
    const x = input(portfolio('M1 Investments'), account('M1 Investments'));
    x.portfolios[0]!.calculation!.valueAsOf = '2026-11-20';
    x.sources.valuations = [
      { accountId: 'm1', name: 'M1 Total', date: '2026-11-05', value: '5000', source: 'provider' },
    ];
    const adjustments = reconcileAccountGains(x);
    expect(adjustments[0]!.applied).toBe(false);
    expect(x.metrics.marketValue!.value).toBe('1000');
  });
  it('matches a Friday evening quote to its Eastern valuation date, not UTC Saturday', () => {
    const a = account();
    a.nativeAccountIds = ['native'];
    const x = input(portfolio(), a);
    x.portfolios[0]!.calculation!.valueAsOf = '2026-11-21T00:59:59.000Z';
    x.sources.valuations = [
      { accountId: 'native', name: a.name, date: '2026-11-19', value: '1000', source: 'provider' },
      { accountId: 'native', name: a.name, date: '2026-11-20', value: '1010', source: 'provider' },
    ];
    reconcileAccountGains(x);
    expect(x.portfolios[0]!.calculation!.currentValue).toBe('1010');
    expect(x.portfolios[0]!.calculation!.daily!.estimated).toBe(false);
    expect(x.portfolios[0]!.calculation!.daily!.currentDate).toBe('2026-11-20');
  });
  it('retains the latest dated crypto account change separately from a later holding quote', () => {
    const p = portfolio('Robinhood Crypto');
    p.calculation!.valueAsOf = '2026-11-21T11:00:00Z';
    const x = input(p);
    x.sources.valuations = [
      { accountId: 'crypto', name: 'Crypto', date: '2026-11-19', value: '87.29', source: 'provider' },
      { accountId: 'crypto', name: 'Crypto', date: '2026-11-20', value: '81.95', source: 'provider' },
    ];
    reconcileAccountGains(x);
    expect(p.calculation!.daily!.change).toBe('-5.34');
    expect(p.calculation!.daily!.currentDate).toBe('2026-11-20');
    expect(p.calculation!.importedDeposits).toBe('0');
  });
});
