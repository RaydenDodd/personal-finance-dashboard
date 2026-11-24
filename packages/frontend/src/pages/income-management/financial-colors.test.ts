import { calculateIncomePlan, createDefaultIncomePlan } from '@bt/shared/finance-income';
import {
  FINANCIAL_COLORS,
  NET_WORTH_COLORS,
  investmentTypeColor,
  investmentSeriesColor,
  payrollDetailColor,
  accountFinancialColor,
} from '@bt/shared/financial-colors';
import { describe, expect, it } from 'vitest';

import { incomeAllocation } from './income-allocation';
describe('shared financial color identities', () => {
  it('preserves primary identities and mode-specific net worth', () => {
    expect([
      FINANCIAL_COLORS.income,
      FINANCIAL_COLORS.savings,
      FINANCIAL_COLORS.investments,
      FINANCIAL_COLORS.retirement,
      FINANCIAL_COLORS.taxes,
      FINANCIAL_COLORS.liabilities,
      FINANCIAL_COLORS.deductions,
    ]).toEqual(['#22C55E', '#EAB308', '#3B82F6', '#A855F7', '#EF4444', '#F97316', '#94A3B8']);
    expect(NET_WORTH_COLORS).toEqual({ dark: '#F5F5F5', light: '#171717' });
  });
  it('maps detailed roles, including matching, without using position', () => {
    expect(payrollDetailColor('employerMatch')).toBe('#C084FC');
    expect(payrollDetailColor('traditional401k')).toBe('#7C3AED');
    expect(payrollDetailColor('federal')).toBe('#B91C1C');
    expect(payrollDetailColor('deduction-a', 'Dental insurance')).toBe('#94A3B8');
    expect(investmentTypeColor('etf')).toBe('#3B82F6');
    expect(investmentTypeColor('crypto')).toBe('#93C5FD');
    expect(accountFinancialColor('Emergency fund')).toBe('#CA8A04');
    const ids = ['m1', 'robinhood', 'public'];
    const before = Object.fromEntries(ids.map((id) => [id, investmentSeriesColor(id)]));
    expect(Object.fromEntries(ids.reverse().map((id) => [id, investmentSeriesColor(id)]))).toEqual(before);
  });
  it('separates savings and investments while preserving the calculated total', () => {
    const input = createDefaultIncomePlan();
    input.annualSalary = 120000;
    input.savings = { kind: 'amount', value: 1000, basis: 'gross' };
    const result = calculateIncomePlan(input);
    const before = structuredClone(result);
    const groups = incomeAllocation(result)!.groups;
    expect(groups.find((g) => g.id === 'savings')!.color).toBe('#EAB308');
    expect(groups.find((g) => g.id === 'investments')!.color).toBe('#3B82F6');
    expect(groups.reduce((sum, g) => sum + g.amount, 0)).toBeCloseTo(result.annual.totalComp, 2);
    expect(result).toEqual(before);
  });
});
