import { calculateIncomePlan, createDefaultIncomePlan } from '@bt/shared/finance-income';
import { describe, expect, it } from 'vitest';

import { incomeAllocation, incomeBreakdown } from './income-allocation';

function calculation() {
  const input = createDefaultIncomePlan();
  input.annualSalary = 120000;
  input.employerBaseContributionPercent = 7;
  input.employerOtherContributionPercent = 0;
  input.roth401k = { kind: 'percent', value: 21, basis: 'gross' };
  input.savings = { kind: 'percent', value: 20, basis: 'takeHome' };
  input.investments = { kind: 'percent', value: 10, basis: 'takeHome' };
  return input;
}
describe('native income chart adapter', () => {
  it('preserves the five separate financial destinations in both native charts without changing the calculation', () => {
    const result = calculateIncomePlan(calculation());
    const before = structuredClone(result);
    const presentation = incomeAllocation(result)!;
    expect(presentation.groups.map((g) => g.name)).toEqual([
      'Spending Money',
      'Savings',
      'Investments',
      'Retirement',
      'Taxes',
    ]);
    expect(
      presentation.groups.find((g) => g.id === 'savings')!.amount +
        presentation.groups.find((g) => g.id === 'investments')!.amount,
    ).toBeCloseTo(result.allocations.find((a) => a.id === 'savingsInvestments')!.yearly, 6);
    expect(presentation.groups.reduce((n, g) => n + g.amount, 0)).toBeCloseTo(result.annual.totalComp, 2);
    expect(presentation.groups.find((g) => g.id === 'taxes')?.children.map((n) => n.name)).toContain('Social Security');
    const retirement = presentation.groups.find((g) => g.id === 'retirement')!;
    expect(
      retirement.children.find((c) => c.id === '401k')?.children.find((c) => c.id === 'employerMatch')?.amount,
    ).toBe(result.annual.employerMatch);
    expect(result).toEqual(before);
  });
  it.each([1, 12, 26])('conserves both sides of every branch when annual values are divided by %s', (divisor) => {
    const result = calculateIncomePlan(calculation());
    const { flow, branches } = incomeAllocation(result, divisor)!;
    const total = result.annual.totalComp / divisor;
    expect(flow.sources.reduce((n, s) => n + s.value, 0)).toBeCloseTo(total, 2);
    expect(flow.expenses + flow.taxes + flow.savings).toBeCloseTo(total, 2);
    expect(branches.reduce((n, b) => n + b.value, 0)).toBeCloseTo(total, 2);
    for (const branch of branches.filter((b) => b.items.length)) {
      expect(branch.items.reduce((n, s) => n + s.value, 0)).toBeCloseTo(branch.value, 2);
    }
  });
  it('keeps payroll deductions distinct instead of relabeling them as tax, savings or spendable cash', () => {
    const input = calculation();
    input.deductions = [
      {
        id: 'health',
        name: 'Health insurance',
        kind: 'health',
        annualAmount: 1200,
        reducesIncomeTax: true,
        reducesFica: true,
      },
    ];
    const result = calculateIncomePlan(input);
    const { groups } = incomeAllocation(result)!;
    expect(groups.find((g) => g.id === 'otherDeductions')?.amount).toBe(1200);
    expect(groups.reduce((n, g) => n + g.amount, 0)).toBeCloseTo(result.annual.totalComp, 2);
  });
  it.each([1, 12, 26])(
    'keeps every original numeric breakdown field, including zero values, at divisor %s',
    (divisor) => {
      const input = calculation();
      const result = calculateIncomePlan(input);
      const before = structuredClone(result);
      const groups = incomeBreakdown(result, input, divisor);
      const fields = groups.flatMap((g) => g.children);
      for (const original of result.breakdown) {
        expect(fields.find((f) => f.id === original.id)?.amount).toBeCloseTo(original.yearly / divisor, 6);
      }
      expect(fields.find((f) => f.id === 'traditionalIra')?.amount).toBe(0);
      expect(fields.find((f) => f.id === 'rothIra')?.amount).toBe(0);
      expect(groups.map((g) => g.id)).toEqual([
        'income',
        'taxes',
        'pre',
        'post',
        'employer',
        'savings',
        'investments',
        'spending',
      ]);
      expect(result).toEqual(before);
    },
  );
  it('does not draw a fictional allocation when the existing calculation has no valid flow', () => {
    const result = calculateIncomePlan(calculation());
    expect(incomeAllocation({ ...result, flow: null })).toBeNull();
  });
});
