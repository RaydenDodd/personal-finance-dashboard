import type { PayrollDashboard } from '@bt/shared/types/payroll';

import type { AdpPayrollRecord } from './adp-companion';

/** Existing identities always keep their verified employment; the owner selects the target for new ones. */
export function planAdpImport(data: PayrollDashboard, records: AdpPayrollRecord[], newEmploymentId: string) {
  if (!data.employments.some((e) => e.id === newEmploymentId))
    throw new Error('Choose an employment for new paychecks.');
  const existing = new Map<string, string>();
  for (const statement of data.statements.filter((s) => s.source === 'adp')) {
    const prior = existing.get(statement.statementId);
    if (prior && prior !== statement.employmentId)
      throw new Error('Conflicting existing employment mapping requires review.');
    existing.set(statement.statementId, statement.employmentId);
  }
  const groups = new Map<string, AdpPayrollRecord[]>(),
    seen = new Set<string>();
  for (const record of records) {
    if (!record.statementId || seen.has(record.statementId))
      throw new Error('Duplicate or missing ADP statement identity.');
    seen.add(record.statementId);
    const employment = existing.get(record.statementId) ?? newEmploymentId;
    groups.set(employment, [...(groups.get(employment) ?? []), record]);
  }
  if (!groups.size) throw new Error('ADP returned no payroll statements.');
  return [...groups].map(([employmentId, rows]) => ({
    employmentId,
    content: JSON.stringify({ payStatements: rows }),
  }));
}
