import { describe, expect, it, jest } from '@jest/globals';
jest.mock('@models/index', () => ({ connection: { sequelize: { query: jest.fn() } } }));
jest.mock('./index', () => ({ getFinanceDashboard: jest.fn() }));
import { assembleRecordedHistory, selectRecordedPeriods } from './native-history';
import type { FinanceAccount, FinanceSnapshot, HistoryPoint } from './types';
const accounts = [
  { id: 'cash', included: true, categoryId: 'spendable', balanceKind: 'asset', currencyCode: 'USD' },
  { id: 'manual', included: true, categoryId: 'investments', balanceKind: 'asset', currencyCode: 'USD' },
] as FinanceAccount[];
const snapshot = (accountId: string, date: string, balance: number) =>
  ({
    id: accountId + date,
    accountId,
    date,
    balance,
    source: 'google-sheets',
    verified: true,
    currencyCode: 'USD',
    createdAt: '',
  }) as FinanceSnapshot;
const snapshots = [
  snapshot('cash', '2022-06-15', 100),
  snapshot('cash', '2024-08-01', 1000),
  snapshot('cash', '2026-11-01', 10000),
  snapshot('manual', '2026-11-01', 200),
];
const history = [
  { date: '2022-06-15', balances: { cash: 100 }, valuationDates: { cash: '2022-06-15' }, complete: true },
  { date: '2024-08-01', balances: { cash: 1000 }, valuationDates: { cash: '2024-08-01' }, complete: true },
  {
    date: '2026-11-01',
    balances: { cash: 10000, manual: 200 },
    valuationDates: { cash: '2026-11-01', manual: '2026-11-01' },
    complete: true,
  },
].map((p) => ({ ...p, total: null, knownTotal: 0, categories: {}, missingAccountIds: [] })) as HistoryPoint[];
describe('native historical source authority', () => {
  it('uses real varying Sheet observations and keeps unavailable liabilities and net worth null', () => {
    const points = assembleRecordedHistory({
      accounts,
      snapshots,
      history,
      mappings: [],
      nativeAccounts: [],
      nativeSnapshots: [],
    });
    expect(points.map((p) => [p.date, p.assetsTotal, p.liabilitiesTotal, p.netWorth])).toEqual([
      ['2022-06-15', 10000, null, null],
      ['2024-08-01', 100000, null, null],
      ['2026-11-01', 1020000, null, null],
    ]);
    expect(selectRecordedPeriods(points, '2022-01-01', '2026-11-04', 'monthly')).toHaveLength(3);
    expect(selectRecordedPeriods(points, '2023-01-01', '2023-12-31', 'monthly')).toEqual([]);
  });
  it('uses provider effective dates after cutoff, includes manual fallback once, debt, and excludes disabled assets', () => {
    const nativeAccounts = [
      { id: 'native', name: 'Bank', currencyCode: 'USD', accountCategory: 'cash', excludeFromStats: false },
      { id: 'card', name: 'Card', currencyCode: 'USD', accountCategory: 'credit-card', excludeFromStats: false },
      { id: 'excluded', name: 'Excluded', currencyCode: 'USD', accountCategory: 'investment', excludeFromStats: true },
    ];
    const nativeSnapshots = [
      { id: '1', nativeAccountId: 'native', date: '2026-11-05', balanceCents: 1200000, createdAt: '1' },
      { id: '2', nativeAccountId: 'card', date: '2026-11-05', balanceCents: -50000, createdAt: '1' },
      { id: '3', nativeAccountId: 'excluded', date: '2026-11-05', balanceCents: 9000000, createdAt: '1' },
    ];
    const points = assembleRecordedHistory({
      accounts,
      snapshots,
      history,
      mappings: [{ id: 'group', label: 'Cash', sourceAccountIds: ['cash'], nativeAccountIds: ['native'] }],
      nativeAccounts,
      nativeSnapshots,
    });
    expect(points.at(-1)).toMatchObject({
      date: '2026-11-05',
      assetsTotal: 1220000,
      liabilitiesTotal: -50000,
      netWorth: 1170000,
      complete: true,
      valuationDates: { manual: '2026-11-01', native: '2026-11-05', card: '2026-11-05' },
    });
    expect(points.filter((p) => p.date < '2026-11-05').every((p) => p.liabilitiesTotal === null)).toBe(true);
  });
  it('does not turn an empty date heading into a financial observation', () => {
    expect(
      assembleRecordedHistory({
        accounts,
        snapshots: [],
        history: [],
        mappings: [],
        nativeAccounts: [],
        nativeSnapshots: [],
      }),
    ).toEqual([]);
  });
});

describe('historical savings grouping', () => {
  it('retains original dated savings separately from cash and investments', () => {
    const result = assembleRecordedHistory({
      accounts: [
        { id: 'saved', included: true, categoryId: 'savings', balanceKind: 'asset', currencyCode: 'USD' },
        { id: 'invested', included: true, categoryId: 'investments', balanceKind: 'asset', currencyCode: 'USD' },
      ] as FinanceAccount[],
      snapshots: [],
      history: [
        {
          date: '2024-08-01',
          balances: { saved: 200, invested: 300 },
          valuationDates: {},
          complete: true,
          total: 500,
          knownTotal: 500,
          categories: { savings: 200, investments: 300 },
          missingAccountIds: [],
        },
      ],
      mappings: [],
      nativeAccounts: [],
      nativeSnapshots: [],
    });
    expect(result[0]!.assets.savings).toBe(20000);
    expect(result[0]!.assets.investments).toBe(30000);
    expect(result[0]!.assets.cash).toBe(0);
    expect(result[0]!.assetsTotal).toBe(50000);
    expect(result[0]!.liabilitiesTotal).toBeNull();
  });
});

describe('native account category grouping', () => {
  it('uses the editable savings category for recorded bank balances', () => {
    const [p] = assembleRecordedHistory({
      accounts: [],
      snapshots: [],
      history: [],
      mappings: [],
      nativeAccounts: [
        {
          id: 'saved',
          name: 'Emergency fund',
          accountCategory: 'saving',
          currencyCode: 'USD',
          excludeFromStats: false,
        },
      ],
      nativeSnapshots: [{ id: 's', nativeAccountId: 'saved', date: '2026-11-05', balanceCents: 12500, createdAt: '1' }],
    });
    expect(p!.assets.savings).toBe(12500);
    expect(p!.assets.cash).toBe(0);
    expect(p!.netWorth).toBe(12500);
  });
});
