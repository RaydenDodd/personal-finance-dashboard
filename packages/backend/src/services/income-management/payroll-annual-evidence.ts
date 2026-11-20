import type { PayrollAnnualEvidence, PayrollPeriod, PayrollStatement, PayrollTotals } from '@bt/shared/types/payroll';

import { emptyAllocations, emptyPayrollTotals, payrollCategories, payrollRound } from './payroll-normalize';

/** Include only verified, explicitly reviewed YTD coverage. Never sum checkpoint statements. */
export function annualEvidenceRemainder(evidence: PayrollAnnualEvidence, statements: PayrollStatement[]) {
  const covered = statements.filter(
    (s) =>
      s.employmentId === evidence.employmentId && s.payDate >= `${evidence.year}-01-01` && s.payDate <= evidence.asOf,
  );
  const totals = { ...evidence.totals },
    allocations = { ...evidence.allocations };
  for (const s of covered) {
    for (const key of Object.keys(totals) as (keyof PayrollTotals)[])
      totals[key] = payrollRound(totals[key] - s.totals[key]);
    for (const key of payrollCategories) allocations[key] = payrollRound(allocations[key] - s.allocations[key]);
  }
  // New dated evidence exceeding a historical checkpoint is a conflict, not negative missing income.
  if (totals.gross < -0.02 || totals.net < -0.02) return null;
  return { totals, allocations };
}

export function applyAnnualEvidence({
  evidence,
  statements,
  from,
  through,
  periods,
  yearly,
}: {
  evidence: PayrollAnnualEvidence[];
  statements: PayrollStatement[];
  from: string;
  through: string;
  periods: PayrollPeriod[];
  yearly: boolean;
}) {
  const additional = emptyPayrollTotals(),
    included: PayrollAnnualEvidence[] = [],
    issues: string[] = [];
  const received = structuredClone(periods);
  for (const checkpoint of evidence) {
    // An annual/YTD checkpoint cannot describe arbitrary summer/monthly ranges.
    if (from > `${checkpoint.year}-01-01` || through < checkpoint.asOf) continue;
    const remainder = annualEvidenceRemainder(checkpoint, statements);
    if (!remainder) {
      issues.push(
        `${checkpoint.year}: Dated payroll exceeds the reviewed YTD evidence; historical supplement held for review.`,
      );
      continue;
    }
    included.push(checkpoint);
    for (const key of Object.keys(additional) as (keyof PayrollTotals)[])
      additional[key] = payrollRound(additional[key] + remainder.totals[key]);
    if (!yearly) continue;
    let bucket = received.find((p) => p.date === `${checkpoint.year}-01-01`);
    if (!bucket) {
      bucket = {
        ...emptyPayrollTotals(),
        date: `${checkpoint.year}-01-01`,
        through: `${checkpoint.year}-12-31`,
        statementIds: [],
        allocations: emptyAllocations(),
        incomplete: false,
        previousGross: null,
        change: null,
        changePercent: null,
      };
      received.push(bucket);
    }
    for (const key of Object.keys(additional) as (keyof PayrollTotals)[])
      bucket[key] = payrollRound(bucket[key] + remainder.totals[key]);
    for (const key of payrollCategories)
      bucket.allocations[key] = payrollRound(bucket.allocations[key] + remainder.allocations[key]);
    bucket.basis = 'annual-ytd';
    bucket.evidenceAsOf = checkpoint.asOf;
    bucket.incompleteFields = [...new Set([...(bucket.incompleteFields ?? []), ...checkpoint.incompleteFields])];
    // Annual coverage is known; timing within the year and period comparisons are not.
    bucket.previousGross = bucket.change = bucket.changePercent = null;
    bucket.incomplete = true;
  }
  return { additional, included, received: received.toSorted((a, b) => a.date.localeCompare(b.date)), issues };
}

export function validateAnnualEvidence(
  evidence: PayrollAnnualEvidence[],
  statements: PayrollStatement[],
): string | null {
  const keys = evidence.map((e) => `${e.employmentId}:${e.year}`);
  if (new Set(keys).size !== keys.length || new Set(evidence.map((e) => e.id)).size !== evidence.length)
    return 'Only one reviewed annual checkpoint per employment and year is allowed';
  for (const e of evidence) {
    if (!e.asOf.startsWith(`${e.year}-`) || new Set(e.statementIds).size !== e.statementIds.length)
      return 'Invalid historical evidence period or source identities';
    const sources = statements.filter((s) => e.statementIds.includes(s.id));
    if (
      sources.length !== e.statementIds.length ||
      sources.some(
        (s) => s.employmentId !== e.employmentId || !s.payDate.startsWith(`${e.year}-`) || s.payDate > e.asOf,
      )
    )
      return 'Historical evidence must reference imported statements for the same employment and year';
    if (
      !sources.some((s) => s.payDate === e.asOf && s.grossYtd !== null && Math.abs(s.grossYtd - e.totals.gross) < 0.02)
    )
      return 'Reviewed annual gross must match its imported YTD checkpoint';
    const allocationTotal = payrollRound(payrollCategories.reduce((sum, k) => sum + e.allocations[k], 0));
    if (
      Math.abs(allocationTotal - e.totals.totalCompensation) > 0.02 ||
      Math.abs(e.totals.gross + e.totals.employerRetirement - e.totals.totalCompensation) > 0.02 ||
      Math.abs(e.allocations.net - e.totals.net) > 0.02
    )
      return 'Historical evidence allocations must reconcile to gross, net and total compensation';
    if (!annualEvidenceRemainder(e, statements)) return 'Dated payroll already exceeds this annual checkpoint';
  }
  return null;
}
