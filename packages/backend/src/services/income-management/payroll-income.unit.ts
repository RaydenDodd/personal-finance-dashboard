import type { PayrollStatement } from '@bt/shared/types/payroll';

import { emptyIncomeDocument } from './ledger';
import { emptyPayrollDocument } from './payroll-derivations';
import { reconcileIncomeWithPayroll } from './payroll-income';
import { emptyAllocations, emptyPayrollTotals } from './payroll-normalize';
const statement = (depositIds: string[] = []): PayrollStatement => ({
  id: 'statement',
  employmentId: 'employer',
  source: 'adp',
  statementId: 'source-statement',
  payDate: '2026-06-12',
  periodStart: null,
  periodEnd: null,
  adjustment: false,
  currency: 'USD',
  hours: null,
  regularRate: null,
  annualizedSalary: null,
  earnings: [],
  deductions: [],
  memos: [],
  totals: { ...emptyPayrollTotals(), gross: 1000, net: 700, federal: 300 },
  allocations: emptyAllocations(),
  grossYtd: null,
  issues: [],
  version: 1,
  importedAt: '2026-06-13T00:00:00Z',
  sourceHash: 'hash',
  depositIds,
});
const bank = [{ id: 'bank', date: '2026-06-12', amount: 700, accountId: 'checking', description: 'Payroll' }];
describe('actual payroll reporting adapter', () => {
  it('adds historical net without a bank deposit and leaves unrelated income intact', () => {
    const document = emptyIncomeDocument(),
      payroll = { ...emptyPayrollDocument(), statements: [statement()] };
    const result = reconcileIncomeWithPayroll(
      document,
      [{ ...bank[0]!, amount: 50, description: 'Interest' }],
      payroll,
      '2026-01-01',
      '2026-12-31',
    );
    expect(result.currentBehavior.actualIncome).toBe(750);
    expect(document.paychecks).toEqual([]);
  });
  it('holds a possible native deposit rather than adding it again', () => {
    const result = reconcileIncomeWithPayroll(
      emptyIncomeDocument(),
      bank,
      { ...emptyPayrollDocument(), statements: [statement()] },
      '2026-01-01',
      '2026-12-31',
    );
    expect(result.currentBehavior.actualIncome).toBe(700);
    expect(result.payrollCoverage.pendingDepositMatches).toBe(1);
  });
  it('counts split deposits once with one gross/withholding observation', () => {
    const split = [
      { ...bank[0]!, id: 'one', amount: 500 },
      { ...bank[0]!, id: 'two', amount: 200 },
    ];
    const result = reconcileIncomeWithPayroll(
      emptyIncomeDocument(),
      split,
      { ...emptyPayrollDocument(), statements: [statement(['one', 'two'])] },
      '2026-01-01',
      '2026-12-31',
    );
    expect(result.currentBehavior.actualIncome).toBe(700);
    expect(result.periods[0]?.gross).toBe(1000);
    expect(result.periods[0]?.federal).toBe(300);
  });
});
