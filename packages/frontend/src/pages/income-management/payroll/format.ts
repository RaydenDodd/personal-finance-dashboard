import { payrollDetailColor } from '@bt/shared/financial-colors';
import type { PayrollCategory } from '@bt/shared/types/payroll';

export const money = (value: number | null | undefined) =>
  value == null
    ? 'Unavailable'
    : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);
export const payrollCategories: { id: PayrollCategory; name: string; color: string }[] = (
  [
    ['net', 'Take-home pay'],
    ['federal', 'Federal income tax'],
    ['state', 'State income tax'],
    ['local', 'Local income tax'],
    ['socialSecurity', 'Social Security'],
    ['medicare', 'Medicare'],
    ['roth401k', 'Roth 401(k)'],
    ['traditional401k', 'Traditional 401(k)'],
    ['benefits', 'Insurance and benefits'],
    ['other', 'Other payroll deductions'],
    ['noncash', 'Noncash offsets'],
    ['unallocated', 'Unreconciled payroll difference'],
    ['employerRetirement', 'Employer retirement'],
  ] as [PayrollCategory, string][]
).map(([id, name]) => ({ id, name, color: payrollDetailColor(id, name) }));
