import type { IncomePaycheck } from '@bt/shared/types/income-management';
import { parse } from 'csv-parse/sync';
import { randomUUID } from 'node:crypto';

const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
function amount(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const n = Number(text.replace(/[$,]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
function date(value: unknown): string | null {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const formatted = match ? `${match[3]}-${match[1]!.padStart(2, '0')}-${match[2]!.padStart(2, '0')}` : text;
  return /^\d{4}-\d{2}-\d{2}$/.test(formatted) &&
    !Number.isNaN(Date.parse(formatted)) &&
    new Date(formatted).toISOString().slice(0, 10) === formatted
    ? formatted
    : null;
}
export const blankPaycheck = (employerId: string): IncomePaycheck => ({
  id: randomUUID(),
  employerId,
  date: '',
  periodStart: null,
  periodEnd: null,
  evidence: 'actual',
  gross: null,
  bonus: 0,
  net: 0,
  federal: 0,
  state: 0,
  local: 0,
  socialSecurity: 0,
  medicare: 0,
  employerContributions: 0,
  withholdingComplete: false,
  deductions: [],
  nativeTransactionId: null,
  source: 'manual',
  sourceKey: null,
  notes: '',
});
export function parseIncomeCsv(text: string, employerId: string) {
  const parsed = parse(text, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: false,
    max_record_size: 100000,
  }) as Record<string, string>[];
  if (parsed.length > 10000) throw new Error('Import at most 10,000 paychecks at a time');
  const records: IncomePaycheck[] = [],
    issues: string[] = [];
  for (const [index, original] of parsed.entries()) {
    const row = Object.fromEntries(Object.entries(original).map(([name, value]) => [key(name), value]));
    const find = (...names: string[]) => names.map((name) => row[name]).find((value) => value !== undefined);
    const payDate = date(find('date', 'paydate', 'paymentdate'));
    const net = amount(find('net', 'netpay', 'takehome', 'currentnet'));
    if (!payDate || net === null) {
      issues.push(`Row ${index + 2}: an actual pay date and non-negative net pay are required`);
      continue;
    }
    const record: IncomePaycheck = {
      ...blankPaycheck(employerId),
      date: payDate,
      net,
      source: 'csv',
      gross: amount(find('gross', 'grosspay', 'currentgross')),
      bonus: amount(find('bonus', 'bonuspay')) ?? 0,
      federal: amount(find('federal', 'federaltax', 'federalwithholding')) ?? 0,
      state: amount(find('state', 'statetax', 'statewithholding')) ?? 0,
      local: amount(find('local', 'localtax', 'localwithholding')) ?? 0,
      socialSecurity: amount(find('socialsecurity', 'socialsecuritytax', 'oasdi')) ?? 0,
      medicare: amount(find('medicare', 'medicaretax')) ?? 0,
      employerContributions: amount(find('employercontributions', 'employermatch')) ?? 0,
      periodStart: date(find('periodstart')),
      periodEnd: date(find('periodend')),
      sourceKey: find('externalid', 'paycheckid', 'sourcekey')?.trim() || null,
      notes: find('notes', 'description')?.slice(0, 5000) ?? '',
    };
    const evidence = find('evidence', 'status');
    if (evidence === 'estimated' || evidence === 'projected') record.evidence = evidence;
    record.withholdingComplete = ['federal', 'state', 'local', 'socialsecurity', 'medicare'].every(
      (name) => amount(row[name]) !== null,
    );
    if (record.gross !== null && record.bonus > record.gross) {
      issues.push(`Row ${index + 2}: bonus cannot exceed gross wages`);
      continue;
    }
    records.push(record);
  }
  return { records, issues, sourceRows: parsed.length };
}
/** Conservative text extraction: never substitutes YTD values for a current paycheck. */
export function parsePaystubText(text: string, employerId: string) {
  const record = { ...blankPaycheck(employerId), source: 'pdf' as const };
  const foundDate = text.match(
    /(?:pay\s*date|payment\s*date|check\s*date)\s*[:-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i,
  );
  record.date = date(foundDate?.[1]) ?? '';
  const currentAmount = (labels: string) => {
    const pattern = new RegExp(`(?:^|\\n)\\s*(?:${labels})\\s*(?::|\\$)\\s*\\$?([\\d,]+(?:\\.\\d{2})?)`, 'im');
    return amount(text.match(pattern)?.[1]);
  };
  record.gross = currentAmount('current gross|gross pay|gross earnings');
  const net = currentAmount('net pay|net check|net amount|take home pay');
  record.net = net ?? 0;
  record.federal = currentAmount('federal tax|federal withholding|federal income tax') ?? 0;
  record.state = currentAmount('state tax|state withholding|state income tax') ?? 0;
  record.socialSecurity = currentAmount('social security|social security tax|oasdi') ?? 0;
  record.medicare = currentAmount('medicare|medicare tax') ?? 0;
  record.notes =
    'Locally extracted paystub draft. Review current-period fields against the PDF; missing fields were not inferred from YTD totals.';
  const issues: string[] = [];
  if (!record.date) issues.push('Pay date was not recognized; enter it from the paystub');
  if (net === null) issues.push('Current net pay was not recognized; enter it from the paystub');
  if (record.gross === null) issues.push('Current gross pay was not recognized; gross remains unavailable');
  issues.push(
    'Verify all withholding and deduction fields. Unrecognized values are unfilled draft amounts, not proof of zero withholding.',
  );
  return { record, issues, requiresReview: true, text: text.slice(0, 100000) };
}
