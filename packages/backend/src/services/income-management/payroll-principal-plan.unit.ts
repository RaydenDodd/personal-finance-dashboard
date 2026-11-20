import type { PayrollEmployment, PayrollStatement } from '@bt/shared/types/payroll';
import { principalFor } from '@services/personal-finance/calculations';
import type { FinanceAccount, FinanceCashFlow } from '@services/personal-finance/types';

import { emptyPayrollDocument } from './payroll-derivations';
import { normalizeAdpStatement } from './payroll-normalize';
import { buildPayrollPrincipalPlan } from './payroll-principal-plan';

const employment: PayrollEmployment = {
  id: 'job',
  employerName: 'Synthetic employer',
  jobTitle: '',
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
const account: FinanceAccount = {
  id: 'retirement',
  userId: 1,
  name: 'Synthetic retirement',
  currencyCode: 'USD',
  categoryId: 'retirement',
  included: true,
  balanceKind: 'asset',
  nativeAccountId: null,
  preferredSource: 'manual',
  description: '',
  createdAt: '',
};
const paycheck = (date: string, ytd = 100, extra: Partial<PayrollStatement> = {}) => {
  const amount = (amountValue: number) => ({ amountValue, currencyCode: 'USD' });
  const s = normalizeAdpStatement(
    {
      statementId: date,
      payDate: date,
      grossPayAmount: amount(100),
      netPayAmount: amount(80),
      grossPayYTDAmount: amount(ytd),
      earnings: [
        { earningCodeName: 'Regular', earningAmount: amount(100), earningYTDAmount: amount(ytd), payRate: amount(100) },
      ],
      deductions: [
        {
          CodeName: 'Roth 401K Basic',
          deductionCategoryCodeName: 'Retirement',
          deductionAmount: amount(-10),
          deductionYTDAmount: amount(ytd / 10),
        },
        { CodeName: 'Federal Income Tax', deductionCategoryCodeName: 'Taxes', deductionAmount: amount(-10) },
      ],
      memos: [
        { nameCode: { codeValue: 'rothmatch' }, memoAmount: amount(2), memoYTDAmount: amount(ytd / 50) },
        { nameCode: { codeValue: 'coretcontrib' }, memoAmount: amount(1), memoYTDAmount: amount(ytd / 100) },
      ],
    },
    employment,
    'adp',
    '2026-11-19T12:00:00Z',
  );
  return { ...s, id: date, ...extra };
};
const flow = (date: string, extra: Partial<FinanceCashFlow> = {}): FinanceCashFlow => ({
  id: 'legacy-' + date,
  accountId: account.id,
  date,
  amount: 13,
  type: 'contribution',
  toAccountId: null,
  description: 'Original source',
  opening: true,
  createdAt: '',
  source: 'google-sheets',
  verified: true,
  evidence: { principalValidThrough: date },
  ...extra,
});
const doc = (...statements: PayrollStatement[]) => ({
  ...emptyPayrollDocument(),
  revision: 1,
  employments: [employment],
  statements,
});
const plan = (statements: PayrollStatement[], flows: FinanceCashFlow[]) =>
  buildPayrollPrincipalPlan(doc(...statements), [account], flows, employment.id, account.id, 'synthetic-hash');

describe('actual payroll retirement principal reconciliation', () => {
  it('requires an explicitly selected owned USD retirement asset and existing employment', () => {
    expect(() => buildPayrollPrincipalPlan(doc(), [account], [], 'missing', account.id, '')).toThrow(/employment/);
    for (const change of [
      { id: 'other' },
      { currencyCode: 'EUR' },
      { categoryId: 'savings' },
      { balanceKind: 'liability' as const },
    ])
      expect(() =>
        buildPayrollPrincipalPlan(doc(), [{ ...account, ...change }], [], employment.id, account.id, ''),
      ).toThrow(/owned USD retirement/);
  });

  it('links an original combined contribution with exact components and preserves its opening and date', () => {
    const original = flow('2026-05-30', { opening: false });
    const result = plan([paycheck('2026-05-29')], [original]);
    expect(result.actions[0]).toMatchObject({ status: 'link', cashFlowId: original.id, employee: 10, employer: 3 });
    expect(result.records[0]).toMatchObject({
      amount: 13,
      date: '2026-05-29',
      opening: false,
      note: `MoneyMatter cash-flow: ${original.id}`,
      evidence: { verifiedComponents: true, employeeAmount: 10, employerAmount: 3 },
    });
    expect(original.date).toBe('2026-05-30');
    expect(original.evidence).not.toHaveProperty('verifiedComponents');
  });

  it('does not add historical payroll already included by a cumulative principal checkpoint', () => {
    const result = plan(
      [paycheck('2026-05-29')],
      [flow('2026-05-01', { amount: 1000, evidence: { checkpoint: true, principalValidThrough: '2026-05-29' } })],
    );
    expect(result.actions[0]!.status).toBe('covered');
    expect(result.records).toEqual([]);
    expect(result.coverageExtension).toBeUndefined();
  });

  it('adds only verified later contributions and extends coverage only after every component reconciles', () => {
    const result = plan([paycheck('2026-05-29'), paycheck('2026-06-12', 200)], [flow('2026-05-29')]);
    expect(result.actions.map((a) => a.status)).toEqual(['link', 'insert']);
    expect(result.totals).toEqual({ employee: 20, employer: 6, total: 26 });
    expect(result.coverageExtension).toMatchObject({
      from: '2026-05-29',
      through: '2026-06-12',
      proof: { legacyMatchedCount: 1, beforeCents: { gross: 10000 }, afterCents: { gross: 20000 } },
    });
  });

  it('keeps coverage incomplete if gross YTD shows a missing paycheck', () => {
    const result = plan([paycheck('2026-05-29'), paycheck('2026-06-12', 300)], [flow('2026-05-29')]);
    expect(result.records).toHaveLength(2);
    expect(result.coverageExtension).toBeUndefined();
  });

  it('requires each employer YTD component independently, even if their sum still matches', () => {
    const next = paycheck('2026-06-12', 200);
    next.memos[0]!.ytd = 3.99;
    next.memos[1]!.ytd = 2.01;
    expect(plan([paycheck('2026-05-29'), next], [flow('2026-05-29')]).coverageExtension).toBeUndefined();
  });

  it('never claims continuous coverage across an unproven year boundary or missing original components', () => {
    expect(
      plan([paycheck('2026-05-29'), paycheck('2027-01-08')], [flow('2026-05-29')]).coverageExtension,
    ).toBeUndefined();
    expect(
      plan(
        [paycheck('2026-05-29'), paycheck('2026-06-12', 200)],
        [flow('2026-05-29'), flow('2026-05-01', { id: 'unmapped', opening: false })],
      ).coverageExtension,
    ).toBeUndefined();
  });

  it('blocks ambiguous or mismatched overlapping movements instead of adding another contribution', () => {
    for (const originals of [
      [flow('2026-06-12', { amount: 12, opening: false })],
      [flow('2026-06-12', { id: 'a', opening: false }), flow('2026-06-12', { id: 'b', opening: false })],
    ]) {
      const result = plan([paycheck('2026-06-12')], originals);
      expect(result.actions[0]!.status).toBe('conflict');
      expect(result.records).toEqual([]);
    }
  });

  it('does not silently remap a previously reconciled payroll source to another retirement account', () => {
    const result = plan(
      [paycheck('2026-05-29')],
      [
        flow('2026-05-29', {
          accountId: 'other',
          source: 'payroll',
          sourceId: 'payroll:job',
          sourceKey: 'pay-date:2026-05-29',
        }),
      ],
    );
    expect(result.actions[0]!.status).toBe('conflict');
    expect(result.records).toEqual([]);
  });

  it('recognizes linked legacy source references on replay and blocks a second account mapping', () => {
    const original = flow('2026-05-29');
    const source = paycheck('2026-05-29');
    const first = plan([source], [original]);
    const linked = {
      ...original,
      evidence: {
        ...original.evidence,
        ...first.records[0]!.evidence,
        payrollSourceId: 'payroll:job',
        payrollSourceKey: 'pay-date:2026-05-29',
      },
    };
    const replay = plan([source], [linked]);
    expect(replay.actions[0]!.status).toBe('duplicate');
    expect(replay.records[0]!.opening).toBe(true);
    expect(replay.records[0]!.note).toBe(`MoneyMatter cash-flow: ${original.id}`);
    expect(plan([source], [{ ...linked, accountId: 'other' }]).actions[0]!.status).toBe('conflict');
    source.totals.employeeRetirement = 11;
    expect(plan([source], [linked]).actions[0]!.status).toBe('conflict');
  });

  it('retains a signed contribution refund as an adjustment, without fabricating a withdrawal or inception', () => {
    const refund = paycheck('2026-06-12');
    refund.totals.employeeRetirement = -2;
    refund.totals.employerMatch = -1;
    refund.totals.employerOtherRetirement = 0;
    refund.totals.employerRetirement = -1;
    const result = plan([refund], []);
    expect(result.records[0]).toMatchObject({
      type: 'adjustment',
      amount: -3,
      evidence: { employeeAmount: -2, employerAmount: -1 },
    });
    expect(result.records[0]!.opening).not.toBe(true);
    expect(result.coverageExtension).toBeUndefined();
    const original = flow('2026-05-29', {
      evidence: { verifiedComponents: true, employeeAmount: 10, employerAmount: 3 },
    });
    const actual = {
      ...result.records[0],
      id: 'refund',
      toAccountId: null,
      opening: false,
      createdAt: '',
    } as FinanceCashFlow;
    expect(principalFor(account.id, [original, actual], '2026-06-12')).toMatchObject({
      principal: 10,
      employeeContributions: 8,
      employerContributions: 2,
    });
  });

  it('blocks zero-total offsetting employee and employer components', () => {
    const check = paycheck('2026-06-12');
    check.totals.employeeRetirement = -3;
    const result = plan([check], []);
    expect(result.actions[0]!.status).toBe('conflict');
    expect(result.records).toEqual([]);
  });

  it('recognizes replayed actual sources and changes the preview token when source state changes', () => {
    const source = paycheck('2026-06-12');
    const first = plan([source], []);
    const recorded = {
      ...first.records[0],
      id: 'recorded',
      toAccountId: null,
      opening: false,
      createdAt: '',
    } as FinanceCashFlow;
    const repeated = plan([source], [recorded]);
    expect(repeated.actions[0]!.status).toBe('duplicate');
    expect(first.previewToken).not.toBe(repeated.previewToken);
    expect(
      buildPayrollPrincipalPlan(
        { ...doc(source), revision: 2 },
        [account],
        [],
        employment.id,
        account.id,
        'synthetic-hash',
      ).previewToken,
    ).not.toBe(first.previewToken);
    expect(
      buildPayrollPrincipalPlan(doc(source), [account], [], employment.id, account.id, 'changed-principal')
        .previewToken,
    ).not.toBe(first.previewToken);
  });
});
