import { calculateIncomePlan, createDefaultIncomePlan } from '@bt/shared/finance-income';
import { describe, expect, it } from 'vitest';

import { incomeAllocation } from './income-allocation';

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
  it('uses the same three destinations for the doughnut, breakdown and Sankey, without changing the calculation', () => {
    const result = calculateIncomePlan(calculation());
    const before = structuredClone(result);
    const presentation = incomeAllocation(result)!;
    expect(presentation.groups.map((g) => g.name)).toEqual(['Taxes', 'Savings', 'Spendable Money']);
    expect(presentation.groups.reduce((n, g) => n + g.amount, 0)).toBeCloseTo(result.annual.totalComp, 2);
    expect(presentation.groups.find((g) => g.id === 'taxes')?.children.map((n) => n.name)).toContain('Social Security');
    const retirement = presentation.groups
      .find((g) => g.id === 'savings')!
      .children.find((c) => c.id === 'retirement')!;
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
    expect(groups.find((g) => g.id === 'deductions')?.amount).toBe(1200);
    expect(groups.reduce((n, g) => n + g.amount, 0)).toBeCloseTo(result.annual.totalComp, 2);
  });
  it('does not draw a fictional allocation when the existing calculation has no valid flow', () => {
    const result = calculateIncomePlan(calculation());
    expect(incomeAllocation({ ...result, flow: null })).toBeNull();
  });
});
