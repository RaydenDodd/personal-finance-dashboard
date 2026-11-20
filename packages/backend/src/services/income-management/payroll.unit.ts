import type { PayrollEmployment } from '@bt/shared/types/payroll';

import { partitionPayrollImport } from './payroll';
import {
  aggregatePayroll,
  buildPayrollDashboard,
  deriveSalaryEvents,
  emptyPayrollDocument,
  getPayrollContributions,
  getPayrollReconciledNet,
} from './payroll-derivations';
import { extractAdpStatements, normalizeAdpStatement, payrollHash } from './payroll-normalize';

jest.mock('@models/index', () => ({ connection: {} }));
jest.mock('./index', () => ({ getBankIncome: jest.fn() }));

const employment: PayrollEmployment = {
  id: 'employment',
  employerName: 'Example Employer',
  jobTitle: 'Engineer',
  startDate: null,
  endDate: null,
  positionStartDate: null,
  positionEndDate: null,
  status: 'current',
  source: 'adp',
  payFrequency: 'biweekly',
  compensationType: 'salary',
  annualHours: null,
  manualAnnualSalary: null,
  notes: '',
};
const amount = (n: number) => ({ amountValue: n, currencyCode: 'USD' });
const raw = (id = 'one', date = '2026-01-02', rate = 1000) => ({
  statementId: id,
  payDate: date,
  payPeriod: { startDate: date, endDate: date },
  grossPayAmount: amount(rate),
  netPayAmount: amount(rate - 400),
  grossPayYTDAmount: amount(rate),
  earnings: [{ earningCodeName: 'Regular   ', earningAmount: amount(rate), payRate: amount(rate) }],
  deductions: [
    { CodeName: 'Federal Income Tax', deductionAmount: amount(-100) },
    { CodeName: 'VA State Income Tax', deductionAmount: amount(-50) },
    { CodeName: 'Social Security Tax', deductionAmount: amount(-60) },
    { CodeName: 'Medicare Tax', deductionAmount: amount(-15) },
    { CodeName: 'Roth 401K Basic', deductionCategoryCodeName: 'Retirement', deductionAmount: amount(-175) },
    { CodeName: 'Checking Acct', deductionCategoryCodeName: 'Banking', deductionAmount: amount(-(rate - 400)) },
  ],
  memos: [
    { nameCode: { codeValue: 'rothmatch', shortName: 'Match' }, memoAmount: amount(40) },
    { nameCode: { codeValue: 'coretcontrib' }, memoAmount: amount(30) },
    { nameCode: { codeValue: 'grouptrmlife' }, memoAmount: amount(5) },
  ],
});
const statement = (id = 'one', date = '2026-01-02', rate = 1000) =>
  normalizeAdpStatement(raw(id, date, rate), employment);
describe('actual payroll normalization and shared calculations', () => {
  it('deduplicates provider identities, updates corrected records in place and preserves separate same-day checks', () => {
    const d = emptyPayrollDocument();
    d.employments = [employment];
    d.statements = [statement('a')];
    const same = partitionPayrollImport(d, [raw('a')], employment.id, 'adp');
    expect(same.duplicates).toBe(1);
    expect(same.accepted).toHaveLength(0);
    const update = partitionPayrollImport(d, [{ ...raw('a'), grossPayAmount: amount(1100) }], employment.id, 'adp');
    expect(update.accepted[0]!.statement.id).toBe(d.statements[0]!.id);
    expect(update.accepted[0]!.statement.version).toBe(2);
    expect(update.accepted[0]!.previous).toBe(d.statements[0]);
    expect(partitionPayrollImport(d, [raw('b')], employment.id, 'adp').accepted).toHaveLength(1);
  });
  it('rejects conflicting duplicate IDs inside one export without first-version wins', () => {
    const d = emptyPayrollDocument();
    d.employments = [employment];
    const result = partitionPayrollImport(
      d,
      [raw('a'), { ...raw('a'), netPayAmount: amount(1) }],
      employment.id,
      'adp',
    );
    expect(result.rejected).toBe(2);
    expect(result.accepted).toHaveLength(0);
  });
  it('does not clone an already verified statement into a different employment', () => {
    const d = emptyPayrollDocument();
    d.employments = [employment, { ...employment, id: 'another' }];
    d.statements = [statement('a')];
    const result = partitionPayrollImport(d, [raw('a')], 'another', 'adp');
    expect(result.accepted).toHaveLength(0);
    expect(result.duplicates).toBe(1);
  });
  it('reads current amounts instead of repeating cumulative YTD and excludes bank distributions', () => {
    const r = raw();
    r.grossPayYTDAmount = amount(90000);
    const p = normalizeAdpStatement(r, employment);
    expect(p.totals.gross).toBe(1000);
    expect(p.grossYtd).toBe(90000);
    expect(p.allocations.unallocated).toBe(0);
    expect(p.totals.employeeRetirement).toBe(175);
    expect(p.totals.employerRetirement).toBe(70);
    expect(p.totals.totalCompensation).toBe(1070);
    expect(p.totals.benefits).toBe(0);
    expect(p.annualizedSalary).toBe(26000);
  });
  it('preserves signed adjustments, refunds and zero net', () => {
    const r = raw();
    r.grossPayAmount = amount(-100);
    r.netPayAmount = amount(-75);
    r.earnings = [];
    r.deductions = [{ CodeName: 'Federal Income Tax', deductionAmount: amount(25) }];
    r.memos = [];
    const p = normalizeAdpStatement({ ...r, payAdjustmentIndicator: true }, employment);
    expect(p.adjustment).toBe(true);
    expect(p.allocations.federal).toBe(-25);
    expect(p.allocations.unallocated).toBe(0);
    expect(p.annualizedSalary).toBeNull();
  });
  it('retains noncash awards and their offsets without treating awards as bank deposits', () => {
    const r = raw();
    r.grossPayAmount = amount(1100);
    r.earnings.push({ earningCodeName: 'Spot Award', earningAmount: amount(100), payRate: amount(0) });
    r.deductions.push({ CodeName: 'Spot Award', deductionAmount: amount(-100) });
    const p = normalizeAdpStatement(r, employment);
    expect(p.totals.bonus).toBe(100);
    expect(p.totals.noncashEarnings).toBe(100);
    expect(p.totals.noncashOffsets).toBe(100);
    expect(p.totals.net).toBe(600);
    expect(p.allocations.unallocated).toBe(0);
  });
  it('keeps missing period detail distinct from zero and does not infer salary from gross', () => {
    const r = raw();
    const p = normalizeAdpStatement(
      { ...r, earnings: [{ earningCodeName: 'Regular', earningYTDAmount: amount(50000) }] },
      employment,
    );
    expect(p.earnings[0]!.amount).toBeNull();
    expect(p.annualizedSalary).toBeNull();
    expect(p.issues.length).toBeGreaterThan(0);
  });
  it('keeps Regular Earn adjustments separate from base Regular earnings and cannot infer a salary from them', () => {
    const p = normalizeAdpStatement(
      {
        ...raw(),
        earnings: [{ earningCodeName: 'Regular Earn   ', earningAmount: amount(1000), payRate: amount(1000) }],
      },
      employment,
    );
    expect(p.totals.regular).toBe(0);
    expect(p.totals.additional).toBe(1000);
    expect(p.earnings[0]!.category).toBe('retroactive');
    expect(p.annualizedSalary).toBeNull();
    const miscellaneous = normalizeAdpStatement(
      { ...raw(), earnings: [{ earningCodeName: 'Miscellaneous', earningAmount: amount(1000) }] },
      employment,
    );
    expect(miscellaneous.totals.bonus).toBe(0);
    expect(miscellaneous.totals.additional).toBe(1000);
  });
  it('rejects invalid dates, missing current totals and foreign currency', () => {
    expect(() => normalizeAdpStatement({ ...raw(), payDate: '2026-02-30' }, employment)).toThrow();
    expect(() => normalizeAdpStatement({ ...raw(), grossPayAmount: undefined }, employment)).toThrow(/YTD/);
    expect(() =>
      normalizeAdpStatement({ ...raw(), netPayAmount: { amountValue: 10, currencyCode: 'EUR' } }, employment),
    ).toThrow(/USD/);
  });
  it('parses wrapped, array or single statements and canonicalizes hashes', () => {
    expect(extractAdpStatements(JSON.stringify({ payStatements: [raw()] }))).toHaveLength(1);
    expect(extractAdpStatements(JSON.stringify([raw()]))).toHaveLength(1);
    expect(extractAdpStatements(JSON.stringify(raw()))).toHaveLength(1);
    expect(payrollHash({ a: 1, b: { z: 2, a: 3 } })).toBe(payrollHash({ b: { a: 3, z: 2 }, a: 1 }));
  });
  it('uses hourly annual hours only when verified, not an assumed 2080', () => {
    const r = raw();
    expect(normalizeAdpStatement(r, { ...employment, compensationType: 'hourly' }).annualizedSalary).toBeNull();
    expect(
      normalizeAdpStatement(r, { ...employment, compensationType: 'hourly', annualHours: 1000 }).annualizedSalary,
    ).toBe(1000000);
  });
  it('retains fractional hourly rates and corroborated initial partial pay rates', () => {
    const partial = normalizeAdpStatement(
      {
        ...raw('p', '2026-01-02'),
        payAdjustmentIndicator: true,
        grossPayAmount: amount(500),
        earnings: [{ earningCodeName: 'Regular', earningAmount: amount(500), payRate: amount(1000) }],
      },
      employment,
    );
    const d = emptyPayrollDocument();
    d.employments = [employment];
    d.statements = [partial, statement('full', '2026-01-16')];
    expect(deriveSalaryEvents(d)[0]!.firstObservedDate).toBe('2026-01-02');
    const hourly = normalizeAdpStatement(
      { ...raw(), earnings: [{ earningCodeName: 'Regular', earningAmount: amount(1000), payRate: amount(25.125) }] },
      { ...employment, compensationType: 'hourly', annualHours: 1000 },
    );
    expect(hourly.regularRate).toBe(25.125);
    expect(hourly.annualizedSalary).toBe(25125);
  });
  it('anchors reminders only to fully successful imports and supports dismissal', () => {
    const d = emptyPayrollDocument();
    d.imports = [
      {
        id: '1',
        at: '2026-01-01T00:00:00.000Z',
        source: 'adp',
        employmentId: 'example',
        inserted: 1,
        updated: 0,
        duplicates: 0,
        rejected: 0,
        issues: [],
        fileHash: 'old',
      },
      {
        id: '2',
        at: '2026-02-15T00:00:00.000Z',
        source: 'adp',
        employmentId: 'example',
        inserted: 0,
        updated: 0,
        duplicates: 0,
        rejected: 1,
        issues: ['invalid'],
        fileHash: 'bad',
      },
    ];
    const options = { from: '2026-01-01', through: '2026-02-16' };
    expect(buildPayrollDashboard(d, [], options, '2026-02-16T00:00:00.000Z').status).toMatchObject({
      lastSuccessfulImport: '2026-01-01T00:00:00.000Z',
      lastSuccessfulSync: null,
      reminderDue: true,
    });
    d.settings.reminderDismissed = true;
    expect(buildPayrollDashboard(d, [], options, '2026-02-16T00:00:00.000Z').status.reminderDue).toBe(false);
  });
  it('derives sustained rate changes and ignores one-off adjustments/bonuses', () => {
    const d = emptyPayrollDocument();
    d.employments = [employment];
    d.statements = [
      statement('a', '2026-01-02'),
      statement('b', '2026-01-16'),
      statement('c', '2026-01-30', 2000),
      statement('d', '2026-02-13'),
      statement('e', '2026-02-27', 1100),
      statement('f', '2026-03-13', 1100),
    ];
    d.statements.push({ ...statement('adj', '2026-01-03', 3000), adjustment: true });
    const events = deriveSalaryEvents(d);
    expect(events.map((e) => e.salary)).toEqual([26000, 28600]);
    expect(events[1]).toMatchObject({
      firstObservedDate: '2026-02-27',
      effectiveDate: null,
      change: 2600,
      changePercent: 10,
    });
  });
  it('supports earlier manual salary and explicit verified corrections', () => {
    const d = emptyPayrollDocument();
    d.employments = [employment];
    d.statements = [statement('a', '2026-01-02'), statement('b', '2026-01-16')];
    const original = deriveSalaryEvents(d)[0]!;
    d.manualSalaryEvents = [
      {
        ...original,
        id: 'correction',
        salary: 25000,
        source: 'manual',
        kind: 'correction',
        effectiveDate: '2025-12-20',
        date: '2025-12-20',
      },
    ];
    expect(deriveSalaryEvents(d)).toEqual([
      expect.objectContaining({ salary: 25000, date: '2025-12-20', source: 'manual' }),
    ]);
  });
  it('aggregates same-day statements independently per paycheck and together monthly', () => {
    const p = [statement('a'), statement('b')];
    expect(aggregatePayroll(p, '2026-01-01', '2026-12-31', 'paycheck')).toHaveLength(2);
    const monthly = aggregatePayroll(p, '2026-01-01', '2026-12-31', 'monthly', '2026-11-19');
    expect(monthly).toHaveLength(1);
    expect(monthly[0]!.gross).toBe(2000);
    expect(monthly[0]!.allocations.net).toBe(1200);
  });
  it('does not compare incomplete or nonadjacent periods as equivalent', () => {
    const p = [statement('a', '2026-01-02'), statement('b', '2026-03-06')];
    const monthly = aggregatePayroll(p, '2026-01-01', '2026-03-15', 'monthly', '2026-03-15');
    expect(monthly[1]!.incomplete).toBe(true);
    expect(monthly[1]!.changePercent).toBeNull();
  });
  it('explains matched and split bank deposits without adding duplicate payroll income', () => {
    const d = emptyPayrollDocument();
    const p = statement();
    d.statements = [p];
    const bank = [{ id: 'bank', date: p.payDate, amount: 600, accountId: 'cash', description: 'Payroll' }];
    expect(getPayrollReconciledNet(d, bank, '2026-01-01', '2026-01-31')).toMatchObject({
      extraNet: 0,
      heldPaycheckIds: [p.id],
    });
    p.depositIds = ['bank'];
    expect(getPayrollReconciledNet(d, bank, '2026-01-01', '2026-01-31')).toMatchObject({
      extraNet: 0,
      matchedBankIds: ['bank'],
    });
    p.depositIds = [];
    expect(getPayrollReconciledNet(d, [], '2026-01-01', '2026-01-31').extraNet).toBe(600);
  });
  it('separates employer retirement from employee deductions and exposes stable source IDs', () => {
    const d = emptyPayrollDocument();
    d.employments = [employment];
    d.statements = [statement()];
    expect(getPayrollContributions(d)[0]).toMatchObject({
      employee: 175,
      employerMatch: 40,
      employerOther: 30,
      total: 245,
      source: 'actual-payroll',
    });
  });
  it('keeps current salary independent from selected historical totals and supports concurrent employment', () => {
    const d = emptyPayrollDocument();
    d.employments = [employment, { ...employment, id: 'second', employerName: 'Other' }];
    d.statements = [
      statement('a', '2026-01-02'),
      statement('b', '2026-01-16'),
      { ...statement('x', '2026-01-02'), employmentId: 'second' },
      { ...statement('y', '2026-01-16'), employmentId: 'second' },
    ];
    const page = buildPayrollDashboard(d, [], { from: '2025-01-01', through: '2025-12-31' });
    expect(page.summary.gross).toBe(0);
    expect(page.summary.currentSalary).toBe(52000);
    expect(page.summary.currentEmployer).toContain('Other');
  });
});
