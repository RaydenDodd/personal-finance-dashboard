import { calculateIncomePlan, createDefaultIncomePlan } from '@bt/shared/finance-income';

import { emptyIncomeDocument } from './ledger';
import { buildFundingEvents, buildPlanPace, type FundingTransaction } from './pace-derivations';
const accounts = [
  { id: 'cash', name: 'Checking (1111)', category: 'cash', excluded: false },
  { id: 'fund', name: 'Emergency (2222)', category: 'saving', excluded: false },
  { id: 'travel', name: 'Travel (3333)', category: 'saving', excluded: false },
  { id: 'broker', name: 'Robinhood individual (4444)', category: 'investment', excluded: false },
  { id: 'crypto', name: 'Robinhood crypto (5555)', category: 'investment', excluded: false },
];
const tx = (
  id: string,
  accountId: string,
  type: string,
  note: string,
  amount = 100,
  date = '2026-11-10',
): FundingTransaction => ({ id, accountId, type, note, amount, date, nature: 'transfer_out_wallet', transferId: null });
describe('planned vs actual funding boundary', () => {
  it('recognizes exported brokerage funding descriptions and the closed M1 emergency fund', () => {
    const notes = [
      'Withdrawal from M1 PAYMENTS',
      'Withdrawal from M1 Cash Acct Deposit',
      'Withdrawal from FID BKG SVC LLC MONEYLINE',
      'Withdrawal from VANGUARD FUNDING',
      'Withdrawal from PUBLIC.COM FUNDING',
      'Digital Card Purchase - RHS BROKERAGE DEPOSIT LAKE MARY FL',
    ];
    const events = buildFundingEvents(
      accounts,
      [],
      notes.map((note, i) => tx(String(i), 'cash', 'expense', note)),
    );
    expect(events).toHaveLength(6);
    expect(events.reduce((total, event) => total + event.amount, 0)).toBe(600);
  });
  it('nets a closed M1 emergency fund migration through checking without creating new savings', () => {
    const events = buildFundingEvents(
      accounts,
      [],
      [
        tx('old', 'cash', 'income', 'Deposit from M1 Cash Acct Withdrawal 251220CA1243122', 1000),
        tx('new', 'cash', 'expense', 'Withdrawal to Emergency Fund XXXXX2222', 1000),
      ],
    );
    expect(events.reduce((total, event) => total + event.amount, 0)).toBe(0);
  });
  it('treats the receiving account number as its own identifier, not as a savings source', () => {
    const deposit = tx(
      'in',
      'broker',
      'income',
      'ACH deposit into Brokerage account ending in 4444',
      100,
      '2026-11-09',
    );
    expect(buildFundingEvents(accounts, [], [deposit])).toEqual([expect.objectContaining({ id: 'in', amount: 100 })]);
    const events = buildFundingEvents(accounts, [], [tx('out', 'cash', 'expense', 'ROBINHOOD'), deposit]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ date: '2026-11-09', amount: 100 });
  });
  it('honors an excluded brokerage even when only its outgoing cash leg exists', () => {
    const excluded = accounts.map((a) => (a.id === 'broker' ? { ...a, excluded: true } : a));
    expect(buildFundingEvents(excluded, [], [tx('out', 'cash', 'expense', 'ROBINHOOD')])).toEqual([]);
  });
  it('does not turn a move from an excluded investment to savings into new savings', () => {
    const excluded = accounts.map((a) => (a.id === 'broker' ? { ...a, excluded: true } : a));
    expect(
      buildFundingEvents(
        excluded,
        [],
        [
          tx('out', 'broker', 'expense', 'Withdrawal to Emergency XXXXX2222'),
          tx('in', 'fund', 'income', 'Deposit from Brokerage XXXXX4444'),
        ],
      ),
    ).toEqual([]);
  });
  it('counts both unlinked legs of checking-to-fund funding once on receipt date', () => {
    const events = buildFundingEvents(
      accounts,
      [],
      [
        tx('out', 'cash', 'expense', 'Withdrawal to Emergency Fund XXXXX2222'),
        tx('in', 'fund', 'income', 'Deposit from Checking XXXXX1111', 100, '2026-11-11'),
      ],
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ amount: 100, date: '2026-11-11' });
  });
  it('does not count moves between savings accounts', () => {
    expect(
      buildFundingEvents(
        accounts,
        [],
        [
          tx('out', 'fund', 'expense', 'Withdrawal to Travel XXXXX3333'),
          tx('in', 'travel', 'income', 'Deposit from Emergency XXXXX2222'),
        ],
      ),
    ).toEqual([]);
  });
  it('counts brokerage funding once, with a separate crypto account and subsequent purchases', () => {
    const events = buildFundingEvents(
      accounts,
      [],
      [
        tx('out', 'cash', 'expense', 'ROBINHOOD'),
        tx('in', 'broker', 'income', 'ACH deposit into brokerage', 100, '2026-11-09'),
        tx('buy', 'broker', 'expense', 'buy 2 shares of TEST'),
        tx('div', 'broker', 'income', 'Cash dividend'),
        tx('reinvest', 'broker', 'expense', 'Dividend reinvestment purchase'),
      ],
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.amount).toBe(100);
  });
  it('keeps two equal real transfers rather than collapsing them', () => {
    const events = buildFundingEvents(
      accounts,
      [],
      [
        tx('a', 'cash', 'expense', 'ROBINHOOD'),
        tx('b', 'cash', 'expense', 'ROBINHOOD'),
        tx('c', 'broker', 'income', 'ACH deposit'),
        tx('d', 'broker', 'income', 'ACH deposit'),
      ],
    );
    expect(events).toHaveLength(2);
    expect(events.reduce((s, e) => s + e.amount, 0)).toBe(200);
  });
  it('subtracts a fund withdrawal and excludes checking-to-checking payments', () => {
    const events = buildFundingEvents(
      accounts,
      [],
      [
        tx('out', 'fund', 'expense', 'Withdrawal to Checking XXXXX1111'),
        tx('in', 'cash', 'income', 'Deposit from Fund XXXXX2222'),
      ],
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.amount).toBe(-100);
  });
  it('preserves a known outbound M1 contribution without inventing an incoming row', () => {
    const events = buildFundingEvents(accounts, [], [tx('out', 'cash', 'expense', 'M1', 200)]);
    expect(events).toHaveLength(1);
    expect(events[0]!.amount).toBe(200);
  });
  it('ignores ordinary expenses, rewards, fees and interest', () => {
    expect(
      buildFundingEvents(
        accounts,
        [],
        [
          tx('i', 'fund', 'income', 'Interest deposit'),
          tx('f', 'broker', 'expense', 'Withdrawal fee'),
          { ...tx('e', 'cash', 'expense', 'ROBINHOOD'), nature: 'not_transfer' },
        ],
      ),
    ).toEqual([]);
  });
  it('uses take-home and outside-payroll funding targets, keeps missing past dates and future actuals null', () => {
    const input = createDefaultIncomePlan();
    input.annualSalary = 120000;
    input.savings = { kind: 'percent', value: 20, basis: 'takeHome' };
    const doc = emptyIncomeDocument();
    doc.plans = [
      {
        id: 'test',
        employerId: null,
        name: 'Synthetic plan',
        effectiveFrom: null,
        effectiveTo: null,
        evidence: 'estimated',
        notes: '',
        input,
      },
    ];
    const result = calculateIncomePlan(input);
    const series = buildPlanPace(
      doc,
      [{ date: '2026-01-02', amount: 1000 }],
      [],
      '2026-01-01',
      '2026-01-03',
      '2026-01-02',
      '2026-01-02',
    );
    expect(series.points[0]!.income).toBeNull();
    expect(series.points[1]!.income).toBe(1000);
    expect(series.points[2]!.income).toBeNull();
    expect(series.points[2]!.plannedIncome).toBeCloseTo((result.annual.takeHome! * 3) / (12 * 31), 1);
    expect(series.points[2]!.plannedSavings).toBeCloseTo((result.annual.savings! * 3) / (12 * 31), 1);
    const february = buildPlanPace(doc, [], [], '2024-02-01', '2024-02-29', '2026-01-02', null);
    expect(february.points.at(-1)!.plannedIncome).toBe(Math.round((result.annual.takeHome! / 12) * 100) / 100);
  });
  it('never draws a salary target without a saved plan', () => {
    const data = buildPlanPace(emptyIncomeDocument(), [], [], '2026-01-01', '2026-01-01', '2026-01-01', null);
    expect(data.points[0]).toMatchObject({ income: null, savings: null, plannedIncome: null, plannedSavings: null });
  });
});
