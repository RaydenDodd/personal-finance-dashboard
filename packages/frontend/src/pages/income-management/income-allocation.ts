import type {
  MoneyFlow,
  MoneyFlowBranch,
  MoneyFlowNode,
} from '@/pages/analytics/subpages/cash-flow/utils/build-money-flow';
import type { IncomeFlowNode, IncomePlanResult } from '@bt/shared/finance-income';

export const incomeColors = {
  income: 'var(--app-income-color)',
  taxes: 'var(--app-expense-color)',
  savings: 'var(--app-savings-color)',
  spending: 'var(--primary)',
  deductions: '#b68a36',
};
export interface IncomeDetail {
  id: string;
  name: string;
  amount: number;
  children: IncomeDetail[];
}
export interface IncomeGroup extends IncomeDetail {
  color: string;
}

/** Adapts the existing calculation tree; no balances, tax rules or allocations are recomputed. */
export function incomeAllocation(
  result: IncomePlanResult,
  divisor = 1,
): {
  groups: IncomeGroup[];
  flow: MoneyFlow;
  branches: MoneyFlowBranch[];
} | null {
  if (!result.available || !result.flow || divisor <= 0) return null;
  const tree = result.flow;
  const child = (id: string) => tree.children?.find((n) => n.id === id);
  const detail = (n: IncomeFlowNode): IncomeDetail => ({
    id: n.id,
    name: n.id === 'employerMatch' ? 'Employer 401(k) match' : n.name,
    amount: n.amount / divisor,
    children: (n.children ?? []).map(detail),
  });
  const group = (id: keyof typeof incomeColors, name: string, node?: IncomeFlowNode): IncomeGroup => ({
    id,
    name,
    color: incomeColors[id],
    amount: (node?.amount ?? 0) / divisor,
    children: (node?.children ?? []).map(detail),
  });
  const taxes = group('taxes', 'Taxes', child('taxes'));
  // Flatten only the presentation's Income Taxes / FICA headings; preserve each actual tax amount.
  taxes.children = taxes.children.flatMap((n) => (n.children.length ? n.children : [n]));
  const savings = group('savings', 'Savings', child('savingsInvestmentsRetirement'));
  savings.children = savings.children.map((n) => ({ ...n, name: n.id === 'savings' ? 'Cash savings' : n.name }));
  const spending = group('spending', 'Spendable Money', child('spending'));
  const deductions = group('deductions', 'Other deductions', child('deductions'));
  const groups = [taxes, savings, spending, ...(deductions.amount > 0 ? [deductions] : [])];
  const leafBreakdown = (n: IncomeDetail): MoneyFlowNode[] =>
    n.children.flatMap((c) =>
      c.children.length
        ? leafBreakdown(c)
        : [{ id: c.id, name: c.name, value: c.amount, share: n.amount > 0 ? c.amount / n.amount : 0 }],
    );
  const items = (g: IncomeGroup): MoneyFlowNode[] =>
    g.children.map((n) => ({
      id: n.id,
      name: n.name,
      value: n.amount,
      color: g.color,
      share: g.amount > 0 ? n.amount / g.amount : 0,
      ...(n.children.length ? { children: leafBreakdown(n) } : {}),
    }));
  const sources = [
    { id: 'salary', name: 'Salary', value: result.annual.salary / divisor },
    { id: 'bonus', name: 'Bonus', value: result.annual.bonus / divisor },
    {
      id: 'other-income',
      name: 'Other income',
      value: (result.annual.gross - result.annual.salary - result.annual.bonus) / divisor,
    },
    { id: 'employer-match', name: 'Employer 401(k) match', value: result.annual.employerMatch / divisor },
    {
      id: 'employer-other',
      name: 'Other employer retirement',
      value: result.annual.employerOtherContribution / divisor,
    },
  ]
    .filter((n) => n.value > 0)
    .map((n) => ({ ...n, color: incomeColors.income, share: n.value / (tree.amount / divisor) }));
  return {
    groups,
    branches: groups.map((g) => ({
      id: g.id,
      name: g.name,
      value: g.amount,
      color: g.color,
      items: items(g),
      shareLabel: `Share of ${g.name.toLowerCase()}`,
    })),
    flow: {
      income: tree.amount / divisor,
      expenses: spending.amount + deductions.amount,
      taxes: taxes.amount,
      savings: savings.amount,
      net: savings.amount,
      deficit: 0,
      sources,
      expenseNodes: [],
      expenseGroups: [],
      taxNodes: items(taxes),
      savingsNodes: items(savings),
    },
  };
}
