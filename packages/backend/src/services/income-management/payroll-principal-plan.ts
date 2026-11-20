import type { PayrollStatement } from '@bt/shared/types/payroll';
import { cents, money } from '@services/personal-finance/calculations';
import { isRecordedDate } from '@services/personal-finance/principal-matching';
import type { PrincipalImportRecord } from '@services/personal-finance/principal-types';
import type { FinanceAccount, FinanceCashFlow } from '@services/personal-finance/types';
import { createHash } from 'node:crypto';

import { getPayrollContributions, type PayrollLedgerDocument } from './payroll-derivations';

export interface PayrollPrincipalAction {
  date: string;
  amount: number;
  employee: number;
  employer: number;
  statementIds: string[];
  status: 'insert' | 'link' | 'duplicate' | 'update' | 'covered' | 'conflict';
  cashFlowId?: string;
  reason?: string;
}
export interface PayrollPrincipalPlan {
  employmentId: string;
  accountId: string;
  payrollRevision: number;
  previewToken: string;
  coverageThrough: string | null;
  proposedCoverageThrough: string | null;
  totals: { employee: number; employer: number; total: number };
  actions: PayrollPrincipalAction[];
  records: PrincipalImportRecord[];
  coverageExtension?: { cashFlowId: string; from: string; through: string; proof: Record<string, unknown> };
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= 7 * 86400000;

/** Require actual period sums to reconcile to every retirement YTD component at both boundaries. */
function verifiedYtdCheckpoint(statements: PayrollStatement[], through: string) {
  const relevant = statements.filter((s) => s.payDate.startsWith(through.slice(0, 4)) && s.payDate <= through);
  const target: Record<string, number> = { gross: relevant.reduce((sum, s) => sum + cents(s.totals.gross), 0) };
  for (const s of relevant) {
    for (const d of s.deductions.filter((line) => ['roth401k', 'traditional401k'].includes(line.category)))
      target[`employee:${d.code}`] = (target[`employee:${d.code}`] ?? 0) - cents(d.amount ?? 0);
    for (const m of s.memos.filter((line) => ['employerMatch', 'employerOtherRetirement'].includes(line.category)))
      target[`employer:${m.code}`] = (target[`employer:${m.code}`] ?? 0) + cents(m.amount ?? 0);
  }
  const candidates = relevant.filter((s) => s.payDate === through);
  for (const s of candidates) {
    if (s.grossYtd === null) continue;
    const reported: Record<string, number> = { gross: cents(s.grossYtd) };
    for (const d of s.deductions.filter(
      (line) => ['roth401k', 'traditional401k'].includes(line.category) && line.ytd !== null,
    ))
      reported[`employee:${d.code}`] = Math.abs(cents(d.ytd!));
    for (const m of s.memos.filter(
      (line) => ['employerMatch', 'employerOtherRetirement'].includes(line.category) && line.ytd !== null,
    ))
      reported[`employer:${m.code}`] = cents(m.ytd!);
    if (
      Object.entries(target).every(([key, amount]) => reported[key] === amount) &&
      Object.entries(reported).every(([key, amount]) => target[key] === amount)
    )
      return reported;
  }
  return null;
}

/** Never infer an account by its name or treat a cumulative principal checkpoint as a new contribution. */
export function buildPayrollPrincipalPlan(
  document: PayrollLedgerDocument,
  accounts: FinanceAccount[],
  flows: FinanceCashFlow[],
  employmentId: string,
  accountId: string,
  principalHash: string,
): PayrollPrincipalPlan {
  if (!document.employments.some((e) => e.id === employmentId))
    throw new Error('Select an existing payroll employment');
  const account = accounts.find((a) => a.id === accountId);
  if (
    !account ||
    account.categoryId !== 'retirement' ||
    account.balanceKind !== 'asset' ||
    account.currencyCode !== 'USD'
  )
    throw new Error('Select an owned USD retirement reporting account');
  const statements = document.statements.filter((s) => s.employmentId === employmentId);
  const contributions = getPayrollContributions(document).filter((c) => c.employmentId === employmentId);
  const groups = new Map<string, typeof contributions>();
  for (const c of contributions) groups.set(c.date, [...(groups.get(c.date) ?? []), c]);
  const own = flows.filter((f) => f.accountId === accountId || f.toAccountId === accountId);
  const opening = own
    .filter((f) => f.accountId === accountId && f.opening)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))[0];
  const coverage =
    typeof opening?.evidence?.principalValidThrough === 'string' &&
    isRecordedDate(opening.evidence.principalValidThrough)
      ? opening.evidence.principalValidThrough
      : opening?.evidence?.checkpoint === true
        ? opening.date
        : null;
  const actions: PayrollPrincipalAction[] = [],
    records: PrincipalImportRecord[] = [],
    claimed = new Set<string>();
  const sourceId = `payroll:${employmentId}`;
  let employeeTotal = 0,
    employerTotal = 0;
  for (const [date, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const employee = group.reduce((sum, c) => sum + cents(c.employee), 0);
    const employer = group.reduce((sum, c) => sum + cents(c.employerMatch) + cents(c.employerOther), 0);
    employeeTotal += employee;
    employerTotal += employer;
    const total = employee + employer;
    const statementIds = group.map((c) => c.statementId).sort();
    const action: PayrollPrincipalAction = {
      date,
      amount: money(total),
      employee: money(employee),
      employer: money(employer),
      statementIds,
      status: 'insert',
    };
    const type = total < 0 ? ('adjustment' as const) : ('contribution' as const);
    const sourceKey = `pay-date:${date}`;
    const evidence = {
      verifiedComponents: true,
      employeeAmount: money(employee),
      employerAmount: money(employer),
      employerMatchAmount: money(group.reduce((sum, c) => sum + cents(c.employerMatch), 0)),
      employerOtherAmount: money(group.reduce((sum, c) => sum + cents(c.employerOther), 0)),
      payrollStatementIds: statementIds,
      payrollEmploymentId: employmentId,
      payrollSourceHashes: statementIds.map((id) => ({ id, hash: statements.find((s) => s.id === id)!.sourceHash })),
      dateBasis: 'Actual payroll pay date; investment posting date may differ',
    };
    const record: PrincipalImportRecord = {
      accountId,
      date,
      amount: money(total),
      type,
      source: 'payroll',
      sourceId,
      sourceKey,
      description: 'Verified actual payroll retirement contribution',
      verified: true,
      contributionKind: 'unspecified',
      evidence,
    };
    const previous = flows.find(
      (f) =>
        (f.source === 'payroll' && f.sourceId === sourceId && f.sourceKey === sourceKey) ||
        (f.evidence?.payrollSourceId === sourceId && f.evidence?.payrollSourceKey === sourceKey),
    );
    if (total === 0) {
      action.status = 'conflict';
      action.reason =
        'Offsetting employee/employer amounts require review; no zero-value principal movement is invented';
    } else if (previous) {
      if (previous.accountId !== accountId) {
        action.status = 'conflict';
        action.reason = 'This payroll source is already mapped to another account';
      } else if (
        previous.source !== 'payroll' &&
        (previous.type !== type ||
          cents(previous.amount) !== total ||
          (previous.evidence?.verifiedComponents === true &&
            (cents(Number(previous.evidence.employeeAmount ?? 0)) !== employee ||
              cents(Number(previous.evidence.employerAmount ?? 0)) !== employer)))
      ) {
        action.status = 'conflict';
        action.reason =
          'Corrected payroll differs from an already linked source movement; review before changing its principal';
      } else {
        action.status =
          previous.type === type &&
          cents(previous.amount) === total &&
          JSON.stringify(previous.evidence?.payrollSourceHashes) === JSON.stringify(evidence.payrollSourceHashes)
            ? 'duplicate'
            : 'update';
        action.cashFlowId = previous.id;
        claimed.add(previous.id);
        records.push(
          previous.source === 'payroll'
            ? record
            : {
                ...record,
                opening: previous.opening,
                note: `MoneyMatter cash-flow: ${previous.id}`,
              },
        );
      }
    } else {
      const nearby = own.filter(
        (f) =>
          f.accountId === accountId &&
          (f.type === 'contribution' || (type === 'adjustment' && f.type === 'adjustment')) &&
          near(f.date, date),
      );
      const matching = nearby.filter(
        (f) =>
          f.type === type &&
          cents(f.amount) === total &&
          !claimed.has(f.id) &&
          (!f.opening || f.date === date) &&
          f.evidence?.checkpoint !== true &&
          f.evidence?.dateUnknown !== true &&
          f.evidence?.estimated !== true &&
          (!f.evidence?.payrollEmploymentId || f.evidence.payrollEmploymentId === employmentId) &&
          (f.contributionKind ?? 'unspecified') === 'unspecified',
      );
      const exact = matching.filter((f) => f.date === date);
      const candidates = exact.length ? exact : matching;
      const candidate = candidates.length === 1 ? candidates[0] : null;
      if (
        candidate &&
        (!candidate.evidence?.verifiedComponents ||
          (cents(Number(candidate.evidence.employeeAmount ?? 0)) === employee &&
            cents(Number(candidate.evidence.employerAmount ?? 0)) === employer))
      ) {
        action.status =
          candidate.evidence?.payrollSourceId === sourceId && candidate.evidence.payrollSourceKey === sourceKey
            ? 'duplicate'
            : 'link';
        action.cashFlowId = candidate.id;
        claimed.add(candidate.id);
        records.push({ ...record, opening: candidate.opening, note: `MoneyMatter cash-flow: ${candidate.id}` });
      } else if (coverage && date <= coverage) {
        action.status = 'covered';
        action.reason =
          'Existing principal coverage includes this date; no additional amount is added without an exact source match';
      } else if (
        nearby.length ||
        candidates.length > 1 ||
        opening?.evidence?.dateUnknown === true ||
        opening?.evidence?.estimated === true
      ) {
        action.status = 'conflict';
        action.reason = 'Overlapping, uncertain or ambiguous existing principal requires review before adding payroll';
      } else records.push(record);
    }
    actions.push(action);
  }
  const totals = {
    employee: money(employeeTotal),
    employer: money(employerTotal),
    total: money(employeeTotal + employerTotal),
  };
  let coverageExtension: PayrollPrincipalPlan['coverageExtension'];
  const latest = statements
    .map((s) => s.payDate)
    .sort()
    .at(-1);
  if (
    opening &&
    coverage &&
    latest &&
    latest > coverage &&
    latest.slice(0, 4) === coverage.slice(0, 4) &&
    opening.evidence?.checkpoint !== true &&
    !actions.some((a) => ['covered', 'conflict'].includes(a.status)) &&
    own
      .filter((f) => f.date <= coverage)
      .every((f) => f.accountId === accountId && f.type === 'contribution' && claimed.has(f.id))
  ) {
    const before = verifiedYtdCheckpoint(statements, coverage),
      after = verifiedYtdCheckpoint(statements, latest);
    if (before && after)
      coverageExtension = {
        cashFlowId: opening.id,
        from: coverage,
        through: latest,
        proof: {
          basis: 'Same-year period gross and each retirement component reconcile to both actual YTD checkpoints',
          beforeCents: before,
          afterCents: after,
          payrollStatementIds: statements
            .filter((s) => s.payDate > coverage && s.payDate <= latest)
            .map((s) => s.id)
            .sort(),
          legacyMatchedCount: own.filter((f) => f.date <= coverage).length,
        },
      };
  }
  const previewToken = hash({
    payrollRevision: document.revision,
    principalHash,
    employmentId,
    accountId,
    sourceHashes: statements.map((s): [string, string] => [s.id, s.sourceHash]).sort(([a], [b]) => a.localeCompare(b)),
    actions,
    coverageExtension,
  });
  return {
    employmentId,
    accountId,
    payrollRevision: document.revision,
    previewToken,
    coverageThrough: coverage,
    proposedCoverageThrough: coverageExtension?.through ?? null,
    totals,
    actions,
    records,
    ...(coverageExtension ? { coverageExtension } : {}),
  };
}
