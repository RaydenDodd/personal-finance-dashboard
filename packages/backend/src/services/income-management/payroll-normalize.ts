import type {
  PayrollCategory,
  PayrollEmployment,
  PayrollLine,
  PayrollStatement,
  PayrollTotals,
} from '@bt/shared/types/payroll';
import { createHash, randomUUID } from 'node:crypto';

export const payrollRound = (n: number) => Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
export const payrollHash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export const payrollCategories: PayrollCategory[] = [
  'net',
  'federal',
  'state',
  'local',
  'socialSecurity',
  'medicare',
  'roth401k',
  'traditional401k',
  'benefits',
  'other',
  'noncash',
  'unallocated',
  'employerRetirement',
];
export const emptyAllocations = (): Record<PayrollCategory, number> =>
  Object.fromEntries(payrollCategories.map((k) => [k, 0])) as Record<PayrollCategory, number>;
export const emptyPayrollTotals = (): PayrollTotals => ({
  gross: 0,
  net: 0,
  regular: 0,
  additional: 0,
  bonus: 0,
  noncashEarnings: 0,
  federal: 0,
  state: 0,
  local: 0,
  socialSecurity: 0,
  medicare: 0,
  employeeRetirement: 0,
  employerMatch: 0,
  employerOtherRetirement: 0,
  employerRetirement: 0,
  benefits: 0,
  otherDeductions: 0,
  noncashOffsets: 0,
  totalCompensation: 0,
});
const object = (n: unknown): Record<string, unknown> =>
  n && typeof n === 'object' && !Array.isArray(n) ? (n as Record<string, unknown>) : {};
const text = (n: unknown) => (typeof n === 'string' ? n.trim().slice(0, 300) : '');
const date = (n: unknown): string | null =>
  typeof n === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(n) &&
  !Number.isNaN(Date.parse(n)) &&
  new Date(n).toISOString().slice(0, 10) === n
    ? n
    : null;
const num = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e10 ? n : null;
const money = (value: unknown): number | null => {
  const item = object(value);
  if (item.currencyCode && item.currencyCode !== 'USD') throw new Error('Only USD payroll is supported');
  const n = num(item.amountValue);
  return n === null ? null : payrollRound(n);
};
const rateAmount = (value: unknown): number | null => {
  const item = object(value);
  if (item.currencyCode && item.currencyCode !== 'USD') throw new Error('Only USD payroll is supported');
  return num(item.amountValue);
};
const list = (value: unknown): Record<string, unknown>[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 300) throw new Error('Invalid payroll detail array');
  return value.map(object);
};
export function classifyPayrollDeduction(name: string, category: string): PayrollCategory | 'banking' | 'employer' {
  const n = name.toLowerCase(),
    c = category.toLowerCase();
  if (c === 'banking' || /checking acct|svgs acct|direct deposit|savings acct/.test(n)) return 'banking';
  if (/employer/.test(n)) return 'employer';
  if (/social security|oasdi/.test(n)) return 'socialSecurity';
  if (/medicare/.test(n)) return 'medicare';
  if (/federal|fed withholding/.test(n)) return 'federal';
  if (/state.*tax|\b(?:va|dc|md|nc|wv) withholding/.test(n)) return 'state';
  if (/local.*tax|city.*tax/.test(n)) return 'local';
  if (/roth.*401|401.*roth/.test(n)) return 'roth401k';
  if (/401/.test(n) && c === 'retirement') return 'traditional401k';
  if (/spot award|gift card|t\s*f\s*b offset|non.?cash/.test(n)) return 'noncash';
  if (c === 'benefits' || /insurance|medical|dental|vision|\bhsa\b|\bfsa\b/.test(n)) return 'benefits';
  return 'other';
}
const regular = (name: string) => /^(regular|personal day|vacation|sick day)$/i.test(name.trim());
const bonus = (name: string) => /bonus|award|aw[d]? gross up|ind achmt|gift card/i.test(name);
const noncash = (name: string) => /spot award|gift card|tfb misc/i.test(name);
export const annualizePayrollRate = (rate: number, employment: PayrollEmployment): number | null => {
  if (employment.compensationType === 'hourly')
    return employment.annualHours ? payrollRound(rate * employment.annualHours) : null;
  const factor = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, annual: 1 }[employment.payFrequency];
  return payrollRound(rate * factor);
};
/** Preserve the source statement fields, without accepting authentication/export session state. */
export function payrollSourceRecord(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    [
      'statementId',
      'payAdjustmentIndicator',
      'payDate',
      'payPeriod',
      'netPayAmount',
      'grossPayAmount',
      'grossPayYTDAmount',
      'totalHours',
      'earnings',
      'deductionCategoryDetails',
      'deductions',
      'memos',
    ]
      .filter((k) => raw[k] !== undefined)
      .map((k) => [k, raw[k]]),
  );
}
export function normalizeAdpStatement(
  raw: Record<string, unknown>,
  employment: PayrollEmployment,
  source = 'adp',
  now = new Date().toISOString(),
): PayrollStatement {
  const statementId = text(raw.statementId),
    payDate = date(raw.payDate);
  if (!statementId || !payDate) throw new Error('Statement ID and valid pay date are required');
  if (typeof raw.statementId !== 'string' || raw.statementId.trim().length > 300)
    throw new Error('Invalid payroll statement ID');
  const gross = money(raw.grossPayAmount),
    net = money(raw.netPayAmount);
  if (gross === null || net === null)
    throw new Error('Current gross and net amounts are required; YTD is not a paycheck amount');
  const issues: string[] = [];
  const period = object(raw.payPeriod),
    periodStart = date(period.startDate),
    periodEnd = date(period.endDate);
  if (periodStart && periodEnd && periodStart > periodEnd) throw new Error('Pay period dates are reversed');
  const earnings: PayrollLine[] = list(raw.earnings).map((e) => {
    const name = text(e.earningCodeName) || 'Unspecified earning';
    return {
      code: name.toLowerCase(),
      name,
      amount: money(e.earningAmount),
      ytd: money(e.earningYTDAmount),
      category: regular(name)
        ? 'regular'
        : noncash(name)
          ? 'noncash'
          : bonus(name)
            ? 'bonus'
            : /overtime/i.test(name)
              ? 'overtime'
              : /retro|^regular earn$/i.test(name)
                ? 'retroactive'
                : 'other',
      preTax: typeof e.preTaxIndicator === 'boolean' ? e.preTaxIndicator : null,
      hours: num(e.payPeriodHours),
      rate: rateAmount(e.payRate),
    };
  });
  const deductions: PayrollLine[] = list(raw.deductions).map((d) => {
    const name = text(d.CodeName ?? d.codeName) || 'Unspecified deduction';
    return {
      code: name.toLowerCase(),
      name,
      amount: money(d.deductionAmount),
      ytd: money(d.deductionYTDAmount),
      category: classifyPayrollDeduction(name, text(d.deductionCategoryCodeName)),
      preTax: typeof d.preTaxIndicator === 'boolean' ? d.preTaxIndicator : null,
    };
  });
  const memos: PayrollLine[] = list(raw.memos).map((m) => {
    const nameCode = object(m.nameCode),
      code = text(nameCode.codeValue).toLowerCase();
    return {
      code,
      name: text(nameCode.shortName) || code || 'Unspecified memo',
      amount: money(m.memoAmount),
      ytd: money(m.memoYTDAmount),
      category:
        code === 'rothmatch' ? 'employerMatch' : code === 'coretcontrib' ? 'employerOtherRetirement' : 'information',
      preTax: null,
    };
  });
  const totals = emptyPayrollTotals(),
    allocations = emptyAllocations();
  totals.gross = gross;
  totals.net = net;
  allocations.net = net;
  for (const e of earnings) {
    const a = e.amount ?? 0;
    if (e.category === 'regular') totals.regular += a;
    if (e.category === 'bonus' || e.category === 'noncash') totals.bonus += a;
    if (e.category === 'noncash') totals.noncashEarnings += a;
  }
  totals.additional = gross - totals.regular;
  for (const d of deductions) {
    if (d.amount === null) continue; // source YTD entries are retained, never summed into current amounts
    if (d.category === 'banking') continue;
    if (d.category === 'employer') {
      // Older exports put informational employer contributions in deductions. Their sign is not a cash deduction.
      if (d.amount)
        issues.push(
          'Employer contribution outside memos requires review; retained without assuming a sign or tax treatment',
        );
      continue;
    }
    const a = -d.amount; // ADP deduction cash effects are signed: a refund remains negative in the allocation
    allocations[d.category as PayrollCategory] += a;
  }
  for (const m of memos) {
    if (m.category === 'employerMatch') totals.employerMatch += m.amount ?? 0;
    if (m.category === 'employerOtherRetirement') totals.employerOtherRetirement += m.amount ?? 0;
  }
  for (const k of ['federal', 'state', 'local', 'socialSecurity', 'medicare', 'benefits'] as const)
    totals[k] = allocations[k];
  totals.employeeRetirement = allocations.roth401k + allocations.traditional401k;
  totals.employerRetirement = totals.employerMatch + totals.employerOtherRetirement;
  totals.otherDeductions = allocations.other;
  totals.noncashOffsets = allocations.noncash;
  totals.totalCompensation = gross + totals.employerRetirement;
  allocations.employerRetirement = totals.employerRetirement;
  allocations.unallocated = payrollRound(
    gross -
      payrollCategories
        .filter((k) => !['unallocated', 'employerRetirement'].includes(k))
        .reduce((s, k) => s + allocations[k], 0),
  );
  if (Math.abs(allocations.unallocated) > 0.02)
    issues.push('Gross does not fully reconcile to reported net and current deductions; residual is shown explicitly');
  if (Math.abs(earnings.reduce((s, e) => s + (e.amount ?? 0), 0) - gross) > 0.02)
    issues.push('Current earnings detail does not reconcile to reported gross');
  const regularRates = [
    ...new Set(
      earnings
        .filter((e) => /^regular$/i.test(e.name.trim()) && e.rate !== null && e.rate! > 0 && (e.amount ?? 0) > 0)
        .map((e) => e.rate!),
    ),
  ];
  const regularRate = regularRates.length === 1 ? regularRates[0]! : null;
  if (regularRates.length > 1) issues.push('Multiple regular pay rates require review');
  if (
    gross === 0 &&
    net === 0 &&
    !regularRate &&
    (money(raw.grossPayYTDAmount) ?? earnings.reduce((s, e) => s + (e.ytd ?? 0), 0)) !== 0
  )
    issues.push('Zero-period statement with a YTD checkpoint; no historical salary is inferred');
  for (const k of Object.keys(totals) as (keyof PayrollTotals)[]) totals[k] = payrollRound(totals[k]);
  for (const k of payrollCategories) allocations[k] = payrollRound(allocations[k]);
  return {
    id: randomUUID(),
    employmentId: employment.id,
    source,
    statementId,
    payDate,
    periodStart,
    periodEnd,
    adjustment: raw.payAdjustmentIndicator === true,
    currency: 'USD',
    hours: num(raw.totalHours),
    regularRate,
    annualizedSalary: regularRate === null ? null : annualizePayrollRate(regularRate, employment),
    earnings,
    deductions,
    memos,
    totals,
    allocations,
    grossYtd: money(raw.grossPayYTDAmount),
    issues,
    version: 1,
    importedAt: now,
    sourceHash: payrollHash(payrollSourceRecord(raw)),
    depositIds: [],
  };
}
export function extractAdpStatements(content: string): Record<string, unknown>[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error('The payroll file is not valid JSON');
  }
  const wrapper = object(data);
  const records = Array.isArray(data)
    ? data
    : Array.isArray(wrapper.payStatements)
      ? wrapper.payStatements
      : wrapper.statementId
        ? [data]
        : null;
  if (!records || records.length === 0 || records.length > 10000)
    throw new Error('Provide ADP payStatements JSON containing one to 10,000 statements');
  return records.map(object);
}
