import type { BankIncomeRow } from '@bt/shared/types/income-management';
import type {
  PayrollDashboard,
  PayrollEmployment,
  PayrollPeriod,
  PayrollReconciliation,
  PayrollSalaryEvent,
  PayrollStatement,
  PayrollTotals,
  PayrollAnnualEvidence,
} from '@bt/shared/types/payroll';

import { applyAnnualEvidence, annualEvidenceRemainder } from './payroll-annual-evidence';
import {
  annualizePayrollRate,
  emptyAllocations,
  emptyPayrollTotals,
  payrollCategories,
  payrollRound,
} from './payroll-normalize';

export interface PayrollLedgerDocument {
  revision: number;
  employments: PayrollEmployment[];
  statements: PayrollStatement[];
  manualSalaryEvents: PayrollSalaryEvent[];
  settings: { reminderDays: number; snoozedUntil: string | null; reminderDismissed: boolean };
  imports: import('@bt/shared/types/payroll').PayrollImportRun[];
  sources: Record<string, Record<string, unknown>>;
  revisions: { statementId: string; replacedAt: string; statement: PayrollStatement; raw: Record<string, unknown> }[];
  annualEvidence?: PayrollAnnualEvidence[];
}
export const emptyPayrollDocument = (): PayrollLedgerDocument => ({
  revision: 0,
  employments: [],
  statements: [],
  manualSalaryEvents: [],
  settings: { reminderDays: 30, snoozedUntil: null, reminderDismissed: false },
  imports: [],
  sources: {},
  revisions: [],
});
export const payrollToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export function sumPayroll(statements: PayrollStatement[]): PayrollTotals {
  const totals = emptyPayrollTotals();
  for (const statement of statements)
    for (const k of Object.keys(totals) as (keyof PayrollTotals)[]) totals[k] += statement.totals[k];
  for (const k of Object.keys(totals) as (keyof PayrollTotals)[]) totals[k] = payrollRound(totals[k]);
  return totals;
}
export function deriveSalaryEvents(
  document: Pick<PayrollLedgerDocument, 'employments' | 'statements' | 'manualSalaryEvents'>,
): PayrollSalaryEvent[] {
  const events: PayrollSalaryEvent[] = [];
  for (const employment of document.employments) {
    const observed = document.statements
      .filter((s) => s.employmentId === employment.id && s.regularRate !== null && s.totals.regular > 0)
      .toSorted((a, b) => a.payDate.localeCompare(b.payDate) || a.statementId.localeCompare(b.statementId));
    const rateDates = new Map<number, Set<string>>();
    for (const s of observed)
      rateDates.set(s.regularRate!, new Set([...(rateDates.get(s.regularRate!) ?? []), s.payDate]));
    const candidates = observed.filter((s) => observed.length === 1 || rateDates.get(s.regularRate!)!.size >= 2);
    let previousSalary: number | null = null;
    for (let i = 0; i < candidates.length; ) {
      const first = candidates[i]!;
      let end = i + 1;
      while (end < candidates.length && candidates[end]!.regularRate === first.regularRate) end++;
      const salary = annualizePayrollRate(first.regularRate!, employment);
      // A one-off rate is evidence, but is not silently asserted to be a sustained raise.
      const sustained = new Set(candidates.slice(i, end).map((s) => s.payDate)).size >= 2;
      if (salary !== null && (sustained || candidates.length === 1)) {
        if (salary !== previousSalary) {
          const change: number | null = previousSalary === null ? null : payrollRound(salary - previousSalary);
          events.push({
            id: `payroll:${employment.id}:${first.statementId}`,
            employmentId: employment.id,
            date: first.payDate,
            effectiveDate: null,
            firstObservedDate: first.payDate,
            periodStart: first.periodStart,
            employerName: employment.employerName,
            jobTitle: employment.jobTitle,
            salary,
            previousSalary,
            change,
            changePercent: previousSalary ? payrollRound((change! / previousSalary) * 100) : null,
            regularRate: first.regularRate,
            source: 'payroll',
            kind: previousSalary === null ? 'starting' : salary > previousSalary ? 'raise' : 'decrease',
            notes: sustained
              ? 'First observed paycheck; effective date is not verified'
              : 'Single observed rate; sustained history is not yet available',
            confirmed: sustained,
          });
          previousSalary = salary;
        }
      }
      i = end;
    }
    const manual = document.manualSalaryEvents.filter((e) => e.employmentId === employment.id);
    for (const event of manual) {
      const index = events.findIndex(
        (e) => e.employmentId === employment.id && e.firstObservedDate === event.firstObservedDate,
      );
      const normalized = {
        ...event,
        employerName: employment.employerName,
        jobTitle: event.jobTitle || employment.jobTitle,
        source: 'manual' as const,
        date: event.effectiveDate ?? event.date,
      };
      if (index >= 0) events[index] = normalized;
      else events.push(normalized);
    }
    if (
      !events.some((e) => e.employmentId === employment.id) &&
      employment.manualAnnualSalary !== null &&
      employment.startDate
    )
      events.push({
        id: `manual-employment:${employment.id}`,
        employmentId: employment.id,
        date: employment.startDate,
        effectiveDate: employment.startDate,
        firstObservedDate: employment.startDate,
        periodStart: null,
        employerName: employment.employerName,
        jobTitle: employment.jobTitle,
        salary: employment.manualAnnualSalary,
        previousSalary: null,
        change: null,
        changePercent: null,
        regularRate: null,
        source: 'manual',
        kind: 'employment',
        notes: employment.notes,
        confirmed: true,
      });
  }
  const sorted = events.toSorted(
    (a, b) => a.date.localeCompare(b.date) || a.employmentId.localeCompare(b.employmentId),
  );
  const previousByEmployer = new Map<string, number>();
  for (const event of sorted) {
    const previous = previousByEmployer.get(event.employmentId) ?? null;
    event.previousSalary = previous;
    event.change = previous === null ? null : payrollRound(event.salary - previous);
    event.changePercent = previous ? payrollRound((event.salary / previous - 1) * 100) : null;
    previousByEmployer.set(event.employmentId, event.salary);
  }
  return sorted;
}
function periodBounds(date: string, aggregation: 'paycheck' | 'monthly' | 'quarterly' | 'yearly') {
  if (aggregation === 'paycheck') return { from: date, through: date };
  const year = Number(date.slice(0, 4)),
    month = Number(date.slice(5, 7)) - 1;
  const startMonth = aggregation === 'yearly' ? 0 : aggregation === 'quarterly' ? Math.floor(month / 3) * 3 : month;
  const months = aggregation === 'yearly' ? 12 : aggregation === 'quarterly' ? 3 : 1;
  return {
    from: new Date(Date.UTC(year, startMonth, 1)).toISOString().slice(0, 10),
    through: new Date(Date.UTC(year, startMonth + months, 0)).toISOString().slice(0, 10),
  };
}
export function aggregatePayroll(
  statements: PayrollStatement[],
  from: string,
  through: string,
  aggregation: 'paycheck' | 'monthly' | 'quarterly' | 'yearly',
  today = payrollToday(),
): PayrollPeriod[] {
  const buckets = new Map<string, PayrollStatement[]>();
  for (const statement of statements.filter((s) => s.payDate >= from && s.payDate <= through)) {
    const key = aggregation === 'paycheck' ? statement.id : periodBounds(statement.payDate, aggregation).from;
    buckets.set(key, [...(buckets.get(key) ?? []), statement]);
  }
  const periods = [...buckets.values()]
    .toSorted((a, b) => a[0]!.payDate.localeCompare(b[0]!.payDate))
    .map((group) => {
      const bounds = periodBounds(group[0]!.payDate, aggregation),
        allocations = emptyAllocations();
      for (const s of group) for (const key of payrollCategories) allocations[key] += s.allocations[key];
      for (const key of payrollCategories) allocations[key] = payrollRound(allocations[key]);
      return {
        ...sumPayroll(group),
        date: bounds.from,
        through: bounds.through,
        statementIds: group.map((s) => s.id),
        allocations,
        incomplete: bounds.from < from || bounds.through > through || bounds.through > today,
        previousGross: null,
        change: null,
        changePercent: null,
      } as PayrollPeriod;
    });
  for (let i = 1; i < periods.length; i++) {
    const previous = periods[i - 1]!,
      current = periods[i]!;
    if (previous.incomplete || current.incomplete) continue;
    // Do not call nonadjacent sparse calendar observations comparable periods.
    if (aggregation !== 'paycheck' && Date.parse(current.date) - Date.parse(previous.through) > 86400000) continue;
    current.previousGross = previous.gross;
    current.change = payrollRound(current.gross - previous.gross);
    current.changePercent =
      previous.gross === 0 ? null : payrollRound((current.change / Math.abs(previous.gross)) * 100);
  }
  return periods;
}
const nearby = (p: PayrollStatement, b: BankIncomeRow) =>
  Math.abs(Date.parse(p.payDate) - Date.parse(b.date)) <= 7 * 86400000;
export function reconcilePayrollDeposits(
  statements: PayrollStatement[],
  bank: BankIncomeRow[],
): PayrollReconciliation[] {
  const claimed = new Set(statements.flatMap((p) => p.depositIds));
  return statements.map((p) => {
    const distributions = p.deductions
      .filter((d) => d.category === 'banking' && d.amount !== null)
      .map((d) => Math.round(-d.amount! * 100));
    const allowed = new Set([Math.round(p.totals.net * 100), ...distributions]);
    const candidates = p.depositIds.length
      ? []
      : bank.filter((b) => !claimed.has(b.id) && nearby(p, b) && allowed.has(Math.round(b.amount * 100)));
    return {
      statementId: p.id,
      linkedDepositIds: p.depositIds,
      candidates,
      status: p.depositIds.length
        ? ('linked' as const)
        : p.totals.net === 0
          ? ('zero-net' as const)
          : candidates.length
            ? ('candidate' as const)
            : ('unmatched' as const),
    };
  });
}
/** No bank writes. Unlinked payroll overlapping candidate deposits is held for review, never added twice. */
export function getPayrollReconciledNet(
  document: Pick<PayrollLedgerDocument, 'statements'>,
  bankIncome: BankIncomeRow[],
  from: string,
  through: string,
) {
  const reconciliation = reconcilePayrollDeposits(document.statements, bankIncome),
    matches = new Map(reconciliation.map((r) => [r.statementId, r]));
  const selected = document.statements.filter((s) => s.payDate >= from && s.payDate <= through);
  const unmatched = selected.filter((s) => matches.get(s.id)?.status === 'unmatched');
  return {
    extraNet: payrollRound(unmatched.reduce((sum, s) => sum + s.totals.net, 0)),
    payrollNet: payrollRound(selected.reduce((sum, s) => sum + s.totals.net, 0)),
    matchedBankIds: selected.flatMap((s) => s.depositIds),
    heldPaycheckIds: selected.filter((s) => matches.get(s.id)?.status === 'candidate').map((s) => s.id),
    unmatched: unmatched.map((s) => ({ id: s.id, date: s.payDate, amount: s.totals.net })),
  };
}
export function getPayrollContributions(document: Pick<PayrollLedgerDocument, 'statements' | 'employments'>) {
  return document.statements
    .filter((s) => s.totals.employeeRetirement !== 0 || s.totals.employerRetirement !== 0)
    .map((s) => ({
      id: `payroll:${s.source}:${s.employmentId}:${s.statementId}`,
      statementId: s.id,
      date: s.payDate,
      employmentId: s.employmentId,
      employer: document.employments.find((e) => e.id === s.employmentId)?.employerName ?? '',
      employee: s.totals.employeeRetirement,
      employerMatch: s.totals.employerMatch,
      employerOther: s.totals.employerOtherRetirement,
      total: payrollRound(s.totals.employeeRetirement + s.totals.employerRetirement),
      source: 'actual-payroll' as const,
    }));
}
export function payrollDataIssues(
  statements: PayrollStatement[],
  annualEvidence: PayrollAnnualEvidence[] = [],
): string[] {
  const issues = statements.flatMap((s) => s.issues.map((i) => `${s.payDate}: ${i}`));
  for (const employmentId of new Set(statements.map((s) => s.employmentId))) {
    for (const year of new Set(
      statements.filter((s) => s.employmentId === employmentId).map((s) => s.payDate.slice(0, 4)),
    )) {
      const group = statements
        .filter((s) => s.employmentId === employmentId && s.payDate.startsWith(year))
        .toSorted((a, b) => a.payDate.localeCompare(b.payDate));
      const latest = group.toReversed().find((s) => s.grossYtd !== null);
      if (!latest) continue;
      if (
        annualEvidence.some(
          (e) => e.employmentId === employmentId && e.year === Number(year) && annualEvidenceRemainder(e, statements),
        )
      )
        continue;
      const gross = payrollRound(
        group.filter((s) => s.payDate <= latest.payDate).reduce((sum, s) => sum + s.totals.gross, 0),
      );
      if (Math.abs(gross - latest.grossYtd!) > 0.02)
        issues.push(
          `${year}: Imported current gross differs from the latest YTD checkpoint by ${payrollRound(latest.grossYtd! - gross).toFixed(2)} USD; prior or corrected statements may be missing. YTD is not added as income.`,
        );
    }
  }
  return [...new Set(issues)];
}
export function buildPayrollDashboard(
  document: PayrollLedgerDocument,
  bank: BankIncomeRow[],
  options: {
    from: string;
    through: string;
    aggregation?: 'paycheck' | 'monthly' | 'quarterly' | 'yearly';
    employmentId?: string;
  },
  now = new Date().toISOString(),
): PayrollDashboard {
  const statements = document.statements
    .filter((s) => !options.employmentId || s.employmentId === options.employmentId)
    .toSorted((a, b) => a.payDate.localeCompare(b.payDate) || a.statementId.localeCompare(b.statementId));
  const selected = statements.filter((s) => s.payDate >= options.from && s.payDate <= options.through),
    totals = sumPayroll(selected);
  const annualEvidence = (document.annualEvidence ?? []).filter(
    (e) => !options.employmentId || e.employmentId === options.employmentId,
  );
  const annual = applyAnnualEvidence({
    evidence: annualEvidence,
    statements,
    from: options.from,
    through: options.through,
    periods: aggregatePayroll(statements, options.from, options.through, options.aggregation ?? 'monthly'),
    yearly: options.aggregation === 'yearly',
  });
  for (const key of Object.keys(totals) as (keyof PayrollTotals)[])
    totals[key] = payrollRound(totals[key] + annual.additional[key]);
  const salaryEvents = deriveSalaryEvents(document),
    today = payrollToday();
  const currentEmployments = document.employments.filter(
    (e) =>
      (!options.employmentId || e.id === options.employmentId) &&
      e.status === 'current' &&
      (!e.startDate || e.startDate <= today) &&
      (!e.endDate || e.endDate >= today),
  );
  const currentEvents = currentEmployments
    .map((e) => salaryEvents.filter((s) => s.employmentId === e.id && s.date <= today).at(-1))
    .filter((e): e is PayrollSalaryEvent => !!e);
  const current = currentEvents.at(-1),
    allForCurrent = current
      ? salaryEvents.filter((s) => s.employmentId === current.employmentId && s.date <= today)
      : [];
  const starting = allForCurrent[0],
    previous = allForCurrent.at(-2),
    lastRaise = allForCurrent.toReversed().find((e) => e.change !== null && e.change > 0);
  const imports = document.imports,
    lastImport = imports.toReversed().find((run) => run.rejected === 0)?.at ?? null;
  const reminderDue =
    !document.settings.reminderDismissed &&
    (!document.settings.snoozedUntil || document.settings.snoozedUntil <= now) &&
    !!lastImport &&
    Date.parse(now) - Date.parse(lastImport) >= document.settings.reminderDays * 86400000;
  const currentEmployment = current ? currentEmployments.find((e) => e.id === current.employmentId) : undefined;
  const positionStart = currentEmployment?.positionStartDate;
  const positionStarting = positionStart
    ? (allForCurrent.filter((e) => e.date <= positionStart).at(-1) ??
      allForCurrent.find((e) => e.date >= positionStart))
    : null;
  const priorYear = new Date(Date.parse(today));
  priorYear.setUTCFullYear(priorYear.getUTCFullYear() - 1);
  const yearAgo = allForCurrent.filter((e) => e.date <= priorYear.toISOString().slice(0, 10)).at(-1);
  const elapsed = (start: string | null | undefined) =>
    start && start <= today ? Math.floor((Date.parse(today) - Date.parse(start)) / 86400000) : null;
  const growth = (base: PayrollSalaryEvent | null | undefined) =>
    current && base ? payrollRound(current.salary - base.salary) : null;
  const growthPercent = (base: PayrollSalaryEvent | null | undefined) =>
    current && base?.salary ? payrollRound((current.salary / base.salary - 1) * 100) : null;
  return {
    revision: document.revision,
    employments: document.employments,
    statements,
    salaryEvents,
    manualSalaryEvents: document.manualSalaryEvents,
    summary: {
      ...totals,
      from: options.from,
      through: options.through,
      count: selected.length,
      currentSalary: currentEvents.length ? payrollRound(currentEvents.reduce((s, e) => s + e.salary, 0)) : null,
      currentEmployer: currentEmployments.map((e) => e.employerName).join(' + ') || null,
      currentJobTitle:
        currentEmployments
          .map((e) => e.jobTitle)
          .filter(Boolean)
          .join(' + ') || null,
      startingSalary: starting?.salary ?? null,
      previousSalary: previous?.salary ?? null,
      salaryGrowth: growth(starting),
      salaryGrowthPercent: growthPercent(starting),
      lastRaiseDate: lastRaise?.date ?? null,
      coverageFrom:
        [statements[0]?.payDate, ...annualEvidence.map((e) => `${e.year}-01-01`)]
          .filter((d): d is string => !!d)
          .toSorted()[0] ?? null,
      coverageThrough: statements.at(-1)?.payDate ?? null,
      positionStartingSalary: positionStarting?.salary ?? null,
      currentPositionGrowth: growth(positionStarting),
      currentPositionGrowthPercent: growthPercent(positionStarting),
      employmentDurationDays: elapsed(currentEmployment?.startDate),
      daysSinceRaise: elapsed(lastRaise?.date),
      yearOverYearGrowth: growth(yearAgo),
      yearOverYearGrowthPercent: growthPercent(yearAgo),
      allTimeSalaryGrowth: growth(starting),
      allTimeSalaryGrowthPercent: growthPercent(starting),
    },
    received: annual.received,
    annualEvidence,
    includedAnnualEvidence: annual.included,
    reconciliation: reconcilePayrollDeposits(statements, bank),
    status: {
      connectionStatus: 'assisted-export',
      lastSuccessfulSync: null,
      lastSuccessfulImport: lastImport,
      latestPaycheck:
        document.statements
          .map((s) => s.payDate)
          .toSorted()
          .at(-1) ?? null,
      statementCount: document.statements.length,
      reminderDue,
      settings: document.settings,
      history: imports.slice(-100).toReversed(),
    },
    issues: [...payrollDataIssues(statements, annualEvidence), ...annual.issues],
  };
}
