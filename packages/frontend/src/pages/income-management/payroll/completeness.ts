import type { PayrollDashboard, PayrollPeriod } from '@bt/shared/types/payroll';

/** Missing fields remain distinct from verified zero amounts in every actual-payroll view. */
export function payrollFieldUnavailable(
  data: PayrollDashboard | undefined,
  field: string,
  employmentId?: string,
): boolean {
  return (
    data?.statements.some(
      (statement) =>
        statement.payDate >= data.summary.from &&
        statement.payDate <= data.summary.through &&
        (!employmentId || statement.employmentId === employmentId) &&
        statement.incompleteFields?.includes(field),
    ) ?? false
  );
}
export function payrollPeriodFieldUnavailable(
  data: PayrollDashboard | undefined,
  period: PayrollPeriod,
  field: string,
): boolean {
  return (
    data?.statements.some(
      (statement) => period.statementIds.includes(statement.id) && statement.incompleteFields?.includes(field),
    ) ?? false
  );
}
