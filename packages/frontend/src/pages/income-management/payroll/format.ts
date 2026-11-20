import type { PayrollCategory } from '@bt/shared/types/payroll';

import { incomeColors } from '../income-allocation';

export const money = (value: number | null | undefined) =>
  value == null
    ? 'Unavailable'
    : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);
export const payrollCategories: { id: PayrollCategory; name: string; color: string }[] = [
  { id: 'net', name: 'Take-home pay', color: incomeColors.spending },
  { id: 'federal', name: 'Federal income tax', color: incomeColors.taxes },
  { id: 'state', name: 'State income tax', color: 'color-mix(in srgb, var(--app-expense-color) 75%, var(--card))' },
  {
    id: 'local',
    name: 'Local income tax',
    color: 'color-mix(in srgb, var(--app-expense-color) 55%, var(--foreground))',
  },
  { id: 'socialSecurity', name: 'Social Security', color: 'color-mix(in srgb, var(--app-expense-color) 65%, #b68a36)' },
  { id: 'medicare', name: 'Medicare', color: 'color-mix(in srgb, var(--app-expense-color) 35%, #b68a36)' },
  { id: 'roth401k', name: 'Roth 401(k)', color: incomeColors.retirement },
  {
    id: 'traditional401k',
    name: 'Traditional 401(k)',
    color: 'color-mix(in srgb, var(--primary) 65%, var(--foreground))',
  },
  { id: 'benefits', name: 'Insurance and benefits', color: incomeColors.savingsInvestments },
  { id: 'other', name: 'Other payroll deductions', color: incomeColors.otherDeductions },
  { id: 'noncash', name: 'Noncash offsets', color: 'var(--muted-foreground)' },
  { id: 'unallocated', name: 'Unreconciled payroll difference', color: 'var(--warning-text)' },
  { id: 'employerRetirement', name: 'Employer retirement', color: 'var(--app-savings-color)' },
];
