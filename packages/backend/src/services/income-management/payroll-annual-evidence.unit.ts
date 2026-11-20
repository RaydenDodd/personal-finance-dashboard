import type { PayrollAnnualEvidence, PayrollEmployment } from '@bt/shared/types/payroll';

import { applyAnnualEvidence, validateAnnualEvidence } from './payroll-annual-evidence';
import { buildPayrollDashboard, emptyPayrollDocument } from './payroll-derivations';
import { emptyAllocations, emptyPayrollTotals, normalizeAdpStatement } from './payroll-normalize';

const employment: PayrollEmployment = {
  id: 'previous',
  employerName: 'Example previous employer',
  jobTitle: '',
  startDate: null,
  endDate: null,
  positionStartDate: null,
  positionEndDate: null,
  status: 'previous',
  source: 'adp',
  payFrequency: 'biweekly',
  compensationType: 'hourly',
  annualHours: null,
  manualAnnualSalary: null,
  notes: '',
};
const amount = (amountValue: number) => ({ amountValue, currencyCode: 'USD' });
const zero = (date: string) =>
  normalizeAdpStatement(
    {
      statementId: date,
      payDate: date,
      grossPayAmount: amount(0),
      netPayAmount: amount(0),
      grossPayYTDAmount: amount(1000),
    },
    employment,
  );
function fixture() {
  const document = emptyPayrollDocument();
  document.employments = [employment];
  document.statements = ['2023-11-24', '2023-12-08', '2023-12-22'].map(zero);
  const evidence: PayrollAnnualEvidence = {
    id: 'annual',
    employmentId: employment.id,
    year: 2023,
    asOf: '2023-12-22',
    statementIds: document.statements.map((s) => s.id),
    sourceLabel: 'Reviewed PDFs',
    documentHash: 'a'.repeat(64),
    totals: {
      ...emptyPayrollTotals(),
      gross: 1000,
      regular: 1000,
      net: 700,
      federal: 200,
      employeeRetirement: 100,
      employerRetirement: 50,
      totalCompensation: 1050,
    },
    allocations: { ...emptyAllocations(), net: 700, federal: 200, roth401k: 100, employerRetirement: 50 },
    incompleteFields: ['employerContributionSplit'],
  };
  document.annualEvidence = [evidence];
  return { document, evidence };
}
describe('reviewed historical annual evidence', () => {
  it('counts repeated YTD only once without modifying or inventing dated paychecks', () => {
    const { document } = fixture(),
      before = structuredClone(document.statements);
    const data = buildPayrollDashboard(document, [], {
      from: '2023-01-01',
      through: '2023-12-31',
      aggregation: 'yearly',
    });
    expect(data.summary.gross).toBe(1000);
    expect(data.summary.net).toBe(700);
    expect(data.summary.employerRetirement).toBe(50);
    expect(data.received).toHaveLength(1);
    expect(data.received[0]).toMatchObject({
      basis: 'annual-ytd',
      evidenceAsOf: '2023-12-22',
      gross: 1000,
      incomplete: true,
    });
    expect(document.statements).toEqual(before);
    expect(data.salaryEvents).toEqual([]);
    expect(data.summary.count).toBe(3);
    expect(data.reconciliation.every((r) => r.status === 'zero-net')).toBe(true);
  });
  it('does not invent monthly or partial-period distributions or add a checkpoint before it is known', () => {
    const { document } = fixture();
    const monthly = buildPayrollDashboard(document, [], {
      from: '2023-01-01',
      through: '2023-12-31',
      aggregation: 'monthly',
    });
    expect(monthly.summary.gross).toBe(1000);
    expect(monthly.received.every((p) => p.gross === 0)).toBe(true);
    for (const bounds of [
      { from: '2023-11-01', through: '2023-12-31' },
      { from: '2023-01-01', through: '2023-12-01' },
    ])
      expect(buildPayrollDashboard(document, [], bounds).summary.gross).toBe(0);
  });
  it('subtracts overlapping dated payroll from the supplement and isolates employers and years', () => {
    const { document, evidence } = fixture();
    document.statements.push(
      normalizeAdpStatement(
        {
          statementId: 'summer',
          payDate: '2023-07-07',
          grossPayAmount: amount(400),
          netPayAmount: amount(280),
          earnings: [{ earningCodeName: 'Regular', earningAmount: amount(400) }],
          deductions: [
            { codeName: 'Federal Income Tax', deductionAmount: amount(-80) },
            { codeName: 'Roth 401K', deductionAmount: amount(-40) },
          ],
        },
        employment,
      ),
    );
    expect(buildPayrollDashboard(document, [], { from: '2023-01-01', through: '2023-12-31' }).summary.gross).toBe(1000);
    expect(buildPayrollDashboard(document, [], { from: '2024-01-01', through: '2024-12-31' }).summary.gross).toBe(0);
    expect(
      buildPayrollDashboard(document, [], { from: '2023-01-01', through: '2023-12-31', employmentId: 'other' }).summary
        .gross,
    ).toBe(0);
    expect(validateAnnualEvidence([evidence, evidence], document.statements)).toContain(
      'one reviewed annual checkpoint',
    );
    expect(validateAnnualEvidence([{ ...evidence, employmentId: 'other' }], document.statements)).toContain(
      'same employment',
    );
  });
  it('holds dated-evidence conflicts and rejects inconsistent gross/net allocations', () => {
    const { document, evidence } = fixture();
    expect(validateAnnualEvidence([evidence], document.statements)).toBeNull();
    expect(
      validateAnnualEvidence([{ ...evidence, totals: { ...evidence.totals, gross: 1001 } }], document.statements),
    ).toContain('YTD');
    expect(
      validateAnnualEvidence(
        [{ ...evidence, allocations: { ...evidence.allocations, net: 701 } }],
        document.statements,
      ),
    ).toContain('reconcile');
    document.statements.push(
      normalizeAdpStatement(
        { statementId: 'conflict', payDate: '2023-07-07', grossPayAmount: amount(1100), netPayAmount: amount(1100) },
        employment,
      ),
    );
    const result = applyAnnualEvidence({
      evidence: [evidence],
      statements: document.statements,
      from: '2023-01-01',
      through: '2023-12-31',
      periods: [],
      yearly: true,
    });
    expect(result.included).toEqual([]);
    expect(result.additional.gross).toBe(0);
    expect(result.issues).toHaveLength(1);
  });
});
