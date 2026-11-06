import {
  buildHistory,
  cents,
  moneyWeightedReturn,
  preferredSnapshots,
  principalFor,
  latestKnownSummary,
} from './calculations';
import type { FinanceAccount, FinanceCashFlow, FinanceSnapshot } from './types';

const account = (id: string, extra: Partial<FinanceAccount> = {}): FinanceAccount => ({
  id,
  userId: 1,
  name: id,
  currencyCode: 'USD',
  categoryId: 'investments',
  included: true,
  balanceKind: 'asset',
  nativeAccountId: null,
  preferredSource: 'manual',
  description: '',
  createdAt: '',
  ...extra,
});
const snapshot = (
  accountId: string,
  date: string,
  balance: number,
  extra: Partial<FinanceSnapshot> = {},
): FinanceSnapshot => ({
  id: `${accountId}-${date}`,
  accountId,
  date,
  balance,
  currencyCode: 'USD',
  source: 'manual',
  verified: true,
  sourceId: 'test',
  sourceKey: `${accountId}-${date}`,
  sourceLabel: '',
  formula: null,
  description: '',
  createdAt: '2026-01-01T00:00:00Z',
  ...extra,
});
const flow = (
  accountId: string,
  amount: number,
  type: FinanceCashFlow['type'],
  extra: Partial<FinanceCashFlow> = {},
): FinanceCashFlow => ({
  id: 'flow',
  accountId,
  amount,
  date: '2024-01-01',
  type,
  toAccountId: null,
  description: '',
  opening: false,
  createdAt: '',
  ...extra,
});

describe('personal finance accounting', () => {
  it('uses a verified cumulative checkpoint without counting the covered same-day contribution again', () => {
    const entries = [
      flow('a', 89, 'contribution', { date: '2025-04-28' }),
      flow('a', 939.21, 'adjustment', { date: '2025-04-28', opening: true, evidence: { checkpoint: true } }),
      flow('a', 10, 'contribution', { date: '2025-05-01' }),
    ];
    expect(principalFor('a', entries, '2025-05-01').principal).toBe(949.21);
  });
  it('uses Sheet history before November 5 and verified provider balances afterward, retaining manual corrections', () => {
    const source = snapshot('a', '2026-11-04', 100, { source: 'google-sheets' });
    const before = snapshot('a', '2026-11-04', 999, { source: 'simplefin', revision: 99 });
    expect(preferredSnapshots([source, before])[0]!.balance).toBe(100);
    const sheet = snapshot('a', '2026-11-05', 110, { source: 'google-sheets' });
    const bank = snapshot('a', '2026-11-05', 120, { source: 'simplefin', revision: 2 });
    const managed = account('a', { preferredSource: 'simplefin' });
    expect(preferredSnapshots([sheet, bank], [managed])[0]!.balance).toBe(120);
    const correction = snapshot('a', '2026-11-05', 115, { source: 'manual', revision: 3 });
    expect(preferredSnapshots([sheet, bank, correction], [managed])[0]!.balance).toBe(115);
    expect(
      preferredSnapshots(
        [sheet, bank, { ...sheet, balance: 116, isManualCorrection: true, revision: 4 }],
        [managed],
      )[0]!.balance,
    ).toBe(116);
    expect(preferredSnapshots([sheet, bank], [account('a')])[0]!.balance).toBe(110);
  });
  it('does not publish a gain beyond the verified contribution coverage date', () => {
    const checkpoint = flow('a', 1000, 'adjustment', {
      opening: true,
      date: '2026-05-29',
      evidence: { principalValidThrough: '2026-05-29' },
    });
    expect(principalFor('a', [checkpoint], '2026-05-29')).toMatchObject({ principal: 1000, principalComplete: true });
    expect(principalFor('a', [checkpoint], '2026-11-05')).toMatchObject({
      principal: null,
      knownPrincipal: 1000,
      principalComplete: false,
    });
  });
  it('does not warn about accounts before their first recorded balance', () => {
    const history = buildHistory(
      [account('old'), account('new')],
      [snapshot('old', '2022-06-15', 10), snapshot('old', '2024-08-01', 20), snapshot('new', '2024-08-01', 5)],
      'monthly',
    );
    expect(history[0]).toMatchObject({ total: 10, complete: true, missingAccountIds: [], inactiveAccountIds: ['new'] });
    const earlier = buildHistory(
      [account('old'), account('new')],
      [snapshot('old', '2022-06-15', 10)],
      'monthly',
      new Map([['new', '2024-08-01']]),
    );
    expect(earlier[0]!.complete).toBe(true);
  });
  it('aggregates categories, selected accounts and liability signs without counting excluded brokerage', () => {
    const history = buildHistory(
      [
        account('cash', { categoryId: 'spendable' }),
        account('debt', { balanceKind: 'liability' }),
        account('vanguard', { included: false }),
      ],
      [
        snapshot('cash', '2026-09-02', 1000.19),
        snapshot('debt', '2026-09-02', -100.11),
        snapshot('vanguard', '2026-09-02', 5000),
      ],
      'monthly',
    );
    expect(history[0]!.total).toBe(900.08);
    expect(history[0]!.categories.spendable).toBe(1000.19);
  });
  it('preserves actual valuation dates and reports a blank as missing instead of zero', () => {
    const point = buildHistory([account('a'), account('b')], [snapshot('a', '2022-06-15', 0)], 'monthly')[0]!;
    expect(point.date).toBe('2022-06-15');
    expect(point.balances).toEqual({ a: 0, b: null });
    expect(point.complete).toBe(false);
    expect(point.total).toBeNull();
    expect(point.knownTotal).toBe(0);
  });
  it('does not forward-fill balances across missing months or days', () => {
    const records = [
      snapshot('a', '2026-01-01', 100),
      snapshot('a', '2026-02-01', 110),
      snapshot('b', '2026-01-01', 50),
    ];
    const history = buildHistory([account('a'), account('b')], records, 'monthly');
    expect(history[1]!.missingAccountIds).toEqual(['b']);
    expect(history[1]!.total).toBeNull();
  });
  it('uses the latest actual day per account in each month while retaining account valuation dates', () => {
    const history = buildHistory(
      [account('a'), account('b')],
      [snapshot('a', '2026-01-05', 10), snapshot('a', '2026-01-25', 20), snapshot('b', '2026-01-10', 30)],
      'monthly',
    );
    expect(history[0]!.total).toBe(50);
    expect(history[0]!.valuationDates).toEqual({ a: '2026-01-25', b: '2026-01-10' });
  });
  it('never silently adds different currencies', () => {
    const point = buildHistory(
      [account('a', { currencyCode: 'EUR' })],
      [snapshot('a', '2026-01-01', 100)],
      'monthly',
    )[0]!;
    expect(point.total).toBeNull();
    expect(point.missingAccountIds).toEqual(['a']);
  });
  it('keeps verified manual history above later provider estimates', () => {
    const manual = snapshot('a', '2026-01-01', 100, { revision: 1 });
    const provider = snapshot('a', '2026-01-01', 110, {
      source: 'simplefin',
      verified: false,
      revision: 2,
      createdAt: '2026-02-01',
    });
    expect(preferredSnapshots([manual, provider])[0]!.balance).toBe(100);
  });
  it('chooses a corrected revision deterministically even with identical timestamps and descending UUIDs', () => {
    const old = snapshot('a', '2026-01-01', 100, { id: 'z', revision: 1 });
    const correction = snapshot('a', '2026-01-01', 120, { id: 'a', revision: 2 });
    expect(preferredSnapshots([old, correction])[0]!.balance).toBe(120);
    expect(old.balance).toBe(100);
  });
  it('permits a correction back to an earlier value without losing the newest revision', () => {
    const original = snapshot('a', '2026-01-01', 100, { revision: 1 });
    const changed = snapshot('a', '2026-01-01', 110, { revision: 2 });
    const reverted = snapshot('a', '2026-01-01', 100, { revision: 3 });
    expect(preferredSnapshots([original, changed, reverted])[0]!.revision).toBe(3);
  });
  it('does not infer principal from valuations or an incomplete contribution ledger', () => {
    expect(principalFor('a', [flow('a', 1000, 'contribution')], '2026-01-01').principal).toBeNull();
  });
  it('keeps dividends and interest out of deposited principal and withdrawals separate', () => {
    const result = principalFor(
      'a',
      [
        flow('a', 1000, 'contribution', { opening: true }),
        flow('a', 500, 'contribution'),
        flow('a', 200, 'withdrawal'),
        flow('a', 50, 'dividend'),
        flow('a', 10, 'interest'),
      ],
      '2026-01-01',
    );
    expect(result).toMatchObject({
      principal: 1300,
      contributions: 1500,
      withdrawals: 200,
      interest: 10,
      dividends: 50,
    });
  });
  it('moves principal between accounts without increasing aggregate outside contributions', () => {
    const entries = [
      flow('a', 1000, 'contribution', { opening: true }),
      flow('b', 0, 'adjustment', { opening: true }),
      flow('a', 300, 'transfer', { toAccountId: 'b' }),
    ];
    const a = principalFor('a', entries, '2026-01-01'),
      b = principalFor('b', entries, '2026-01-01');
    expect(a.principal).toBe(700);
    expect(b.principal).toBe(300);
    expect(a.contributions + b.contributions).toBe(1000);
  });
  it('does not include future contributions in an earlier valuation', () => {
    expect(
      principalFor(
        'a',
        [flow('a', 1000, 'contribution', { opening: true }), flow('a', 500, 'contribution', { date: '2026-12-01' })],
        '2026-01-01',
      ).principal,
    ).toBe(1000);
  });
  it('uses a dated opening adjustment as a basis instead of double counting older cash flows', () => {
    const entries = [
      flow('a', 1000, 'contribution'),
      flow('a', 1500, 'adjustment', { date: '2025-01-01', opening: true }),
      flow('a', 100, 'contribution', { date: '2025-02-01' }),
    ];
    expect(principalFor('a', entries, '2026-01-01').principal).toBe(1600);
  });
  it('calculates annualized XIRR only from a complete inception ledger with reliable dated flows', () => {
    const entries = [flow('a', 1000, 'contribution', { date: '2025-01-01', opening: true })];
    expect(moneyWeightedReturn('a', entries, 1100, '2026-01-01')).toBeCloseTo(10, 4);
    expect(moneyWeightedReturn('a', entries, 1100, '2025-06-01')).toBeNull();
    expect(moneyWeightedReturn('a', [flow('a', 1000, 'adjustment', { opening: true })], 1100, '2026-01-01')).toBeNull();
  });
  it('rejects invalid or sub-cent monetary inputs', () => {
    expect(() => cents(Number.NaN)).toThrow();
    expect(() => cents(0.001)).toThrow();
    expect(cents(0.29)).toBe(29);
  });
  it('includes owner-accepted estimates in principal while withholding independently verified annualized returns', () => {
    const entries = [
      flow('a', 1000, 'contribution', {
        opening: true,
        evidence: { ownerAcceptedLegacy: true, principalValidThrough: '2026-05-29' },
      }),
      flow('a', 200, 'contribution', {
        date: '2026-06-12',
        verified: false,
        evidence: { ownerAccepted: true, estimated: true },
      }),
    ];
    expect(principalFor('a', entries, '2026-11-01')).toMatchObject({
      principal: 1200,
      principalEstimated: true,
      principalComplete: true,
    });
    expect(moneyWeightedReturn('a', entries, 1400, '2026-11-01')).toBeNull();
  });
  it('sums latest-known manual and automatic balances separately from actual sparse historical points', () => {
    const a = [account('manual'), account('bank', { preferredSource: 'simplefin' })];
    const s = [snapshot('manual', '2026-11-01', 100), snapshot('bank', '2026-11-05', 200, { source: 'simplefin' })];
    expect(buildHistory(a, s, 'daily').at(-1)?.knownTotal).toBe(200);
    expect(latestKnownSummary(a, s)).toMatchObject({
      knownTotal: 300,
      complete: true,
      valuationDates: { manual: '2026-11-01', bank: '2026-11-05' },
    });
    expect(s).toHaveLength(2);
  });
});
