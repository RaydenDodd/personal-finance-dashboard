import type { DonutNode } from '@/components/common/charts/drilldown-donut.vue';
import type { PayrollDashboard } from '@bt/shared/types/payroll';

import { incomeColors } from '../income-allocation';
import { payrollCategories } from './format';
/** Groups the existing payroll allocation output, preserving its reconciliation bucket. */
export function payrollAllocation(data: PayrollDashboard): DonutNode[] {
  const covered = new Set(data.annualEvidence?.flatMap((e) => e.statementIds) ?? []);
  const rows = data.received.filter(
    (row) =>
      row.basis === 'annual-ytd' ||
      row.gross !== 0 ||
      row.totalCompensation !== 0 ||
      !row.statementIds.every((id) => covered.has(id)),
  );
  const leaves = payrollCategories.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    amount: rows.reduce((sum, row) => sum + (row.allocations[c.id] ?? 0), 0),
  }));
  const group = (id: string, name: string, color: string, keys: string[]): DonutNode => {
    const children = leaves.filter((c) => keys.includes(c.id));
    return { id, name, color, amount: children.reduce((sum, c) => sum + c.amount, 0), children };
  };
  return [
    ...leaves.filter((l) => l.id === 'net'),
    group('taxes', 'Taxes', incomeColors.taxes, ['federal', 'state', 'local', 'socialSecurity', 'medicare']),
    group('retirement', 'Retirement', incomeColors.retirement, ['roth401k', 'traditional401k', 'employerRetirement']),
    group('deductions', 'Deductions', incomeColors.otherDeductions, ['benefits', 'other', 'noncash']),
    ...leaves.filter((l) => l.id === 'unallocated' && l.amount !== 0),
  ];
}
