import type { BankIncomeRow, IncomeDocument, IncomePaycheck } from '@bt/shared/types/income-management';

import { reconcileIncome } from './ledger';
import { reconcilePayrollDeposits, type PayrollLedgerDocument } from './payroll-derivations';

/** Read adapter only: bank transactions, legacy paychecks and saved plans are never rewritten. */
export function reconcileIncomeWithPayroll(
  document: IncomeDocument,
  bank: BankIncomeRow[],
  payroll: PayrollLedgerDocument,
  from: string,
  through: string,
  granularity: 'biweekly' | 'monthly' | 'yearly' | 'daily' = 'monthly',
) {
  const matches = reconcilePayrollDeposits(payroll.statements, bank);
  const coveredManualIds: string[] = [];
  const original = document.paychecks.filter((p) => {
    if (p.evidence !== 'actual') return true;
    const employer = document.employers
      .find((e) => e.id === p.employerId)
      ?.name.toLowerCase()
      .trim();
    const covered = payroll.statements.some((s) => {
      const sourceEmployer = payroll.employments
        .find((e) => e.id === s.employmentId)
        ?.employerName.toLowerCase()
        .trim();
      return (
        employer &&
        sourceEmployer &&
        (employer.includes(sourceEmployer) || sourceEmployer.includes(employer)) &&
        p.date === s.payDate &&
        Math.round(p.net * 100) === Math.round(s.totals.net * 100) &&
        (p.gross === null || Math.round(p.gross * 100) === Math.round(s.totals.gross * 100))
      );
    });
    if (covered) coveredManualIds.push(p.id);
    return !covered;
  });
  const imported: IncomePaycheck[] = [];
  let pending = 0;
  for (const s of payroll.statements) {
    const match = matches.find((r) => r.statementId === s.id)!;
    // A possible split deposit remains a review item, not a second occurrence of income.
    const held = match.status === 'candidate';
    if (held && s.payDate >= from && s.payDate <= through) pending++;
    const base: IncomePaycheck = {
      id: s.id,
      employerId: s.employmentId,
      date: s.payDate,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      evidence: 'actual',
      gross: s.totals.gross,
      bonus: s.totals.bonus,
      net: held ? 0 : s.totals.net,
      federal: s.totals.federal,
      state: s.totals.state,
      local: s.totals.local,
      socialSecurity: s.totals.socialSecurity,
      medicare: s.totals.medicare,
      employerContributions: s.totals.employerRetirement,
      withholdingComplete: !s.issues.some((i) => /missing|unavailable/i.test(i)),
      deductions: [],
      nativeTransactionId: s.depositIds[0] ?? null,
      source: 'pdf',
      sourceKey: s.source + ':' + s.statementId,
      notes: 'Detailed payroll evidence (read-only reporting adapter)',
    };
    imported.push(base);
    // Additional split legs explain the same paycheck; only the first carries gross/tax evidence.
    for (const id of s.depositIds.slice(1))
      imported.push({
        ...base,
        id: s.id + ':' + id,
        nativeTransactionId: id,
        gross: 0,
        bonus: 0,
        net: 0,
        federal: 0,
        state: 0,
        local: 0,
        socialSecurity: 0,
        medicare: 0,
        employerContributions: 0,
      });
  }
  const result = reconcileIncome(
    { ...document, paychecks: [...original, ...imported] },
    bank,
    from,
    through,
    granularity,
  );
  result.currentBehavior.heldForReconciliation += pending;
  result.currentBehavior.basis +=
    ' Detailed payroll replaces matched legacy paycheck evidence; split bank deposits are counted once. Potential deposit matches remain held for review. Original records and projected plans are retained.';
  return {
    ...result,
    payrollCoverage: {
      statements: payroll.statements.length,
      replacedManualEvidenceIds: coveredManualIds,
      pendingDepositMatches: pending,
    },
  };
}
