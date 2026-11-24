import type {
  MoneyFlow,
  MoneyFlowBranch,
  MoneyFlowNode,
} from '@/pages/analytics/subpages/cash-flow/utils/build-money-flow';
import type { IncomeFlowNode, IncomePlanInput, IncomePlanResult } from '@bt/shared/finance-income';
import { FINANCIAL_COLORS as financial, payrollDetailColor } from '@bt/shared/financial-colors';

export const incomeColors = {
  income: financial.income,
  salary: financial.salary,
  bonus: financial.bonus,
  savings: financial.savings,
  investments: financial.investments,
  retirement: financial.retirement,
  employerRetirement: financial.employerRetirement,
  taxes: financial.taxes,
  spending: financial.spendable,
  otherDeductions: financial.deductions,
};
export interface IncomeDetail {
  color?: string;
  id: string;
  name: string;
  amount: number;
  children: IncomeDetail[];
  note?: string;
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
    color: payrollDetailColor(n.id, n.name),
    children: (n.children ?? []).map(detail),
  });
  const savings = child('savingsInvestmentsRetirement');
  const children: Record<string, IncomeFlowNode[]> = {
    spending: [],
    savings: savings?.children?.filter((n) => ['savings', 'hsa'].includes(n.id)) ?? [],
    investments: savings?.children?.filter((n) => n.id === 'investments') ?? [],
    retirement: savings?.children?.find((n) => n.id === 'retirement')?.children ?? [],
    taxes: child('taxes')?.children?.flatMap((n) => n.children ?? [n]) ?? [],
    otherDeductions: child('deductions')?.children ?? [],
  };
  // Keep every original allocation, including Retirement as its own destination.
  const allocations = result.allocations.flatMap((row) =>
    row.id === 'savingsInvestments'
      ? [
          { id: 'savings', label: 'Savings', yearly: result.annual.savings! + result.annual.hsa },
          { id: 'investments', label: 'Investments', yearly: result.annual.investments! },
        ]
      : [row],
  );
  const groups: IncomeGroup[] = allocations.map((row) => ({
    id: row.id,
    name: row.label,
    color: incomeColors[row.id as keyof typeof incomeColors] ?? incomeColors.otherDeductions,
    amount: row.yearly / divisor,
    children: (children[row.id] ?? []).map(detail),
  }));
  const amount = (id: string) => groups.find((g) => g.id === id)?.amount ?? 0;
  const leafBreakdown = (n: IncomeDetail): MoneyFlowNode[] =>
    n.children.flatMap((c) =>
      c.children.length
        ? leafBreakdown(c)
        : [{ id: c.id, name: c.name, value: c.amount, color: c.color, share: n.amount > 0 ? c.amount / n.amount : 0 }],
    );
  const items = (g: IncomeGroup): MoneyFlowNode[] =>
    g.children.map((n) => ({
      id: n.id,
      name: n.name,
      value: n.amount,
      color: n.color ?? g.color,
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
    .map((n) => ({ ...n, color: payrollDetailColor(n.id), share: n.value / (tree.amount / divisor) }));
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
      expenses: amount('spending') + amount('otherDeductions'),
      taxes: amount('taxes'),
      savings: amount('savings') + amount('investments') + amount('retirement'),
      net: amount('savings') + amount('investments') + amount('retirement'),
      deficit: 0,
      sources,
      expenseNodes: [],
      expenseGroups: [],
      taxNodes: items(groups.find((g) => g.id === 'taxes')!),
      savingsNodes: groups.filter((g) => ['savings', 'investments', 'retirement'].includes(g.id)).flatMap(items),
    },
  };
}

/** Original editable-planning breakdown, including zero-value fields and payroll subtotals. */
export function incomeBreakdown(result: IncomePlanResult, input: IncomePlanInput, divisor = 1): IncomeGroup[] {
  if (!result.available || divisor <= 0) return [];
  const a = result.annual;
  const row = (id: string, name: string, amount: number, note?: string): IncomeDetail => ({
    id,
    name,
    amount: amount / divisor,
    color: payrollDetailColor(id, name),
    children: [],
    ...(note ? { note } : {}),
  });
  const group = (id: string, name: string, color: string, amount: number, children: IncomeDetail[]): IncomeGroup => ({
    id,
    name,
    color,
    amount: amount / divisor,
    children,
  });
  const payrollHsa = input.hsaThroughPayroll ? a.hsa : 0;
  const deductions = (pre: boolean) => {
    const records = input.deductions.filter((d) => d.reducesIncomeTax === pre);
    return [
      {
        ...row(
          pre ? 'preTax' : 'postTax',
          pre ? 'Other Pre-Tax Deductions' : 'Other Post-Tax Deductions',
          pre ? a.otherPreTaxDeductions : a.otherPostTaxDeductions,
        ),
        children: records.map((d) => row('deduction-' + d.id, d.name, d.annualAmount)),
      },
    ];
  };
  return [
    group('income', 'Income and take-home pay', incomeColors.income, a.takeHome!, [
      row('gross', 'Gross income', a.gross),
      row('net', 'Net salary after taxes', a.net!),
      row('takeHome', 'Take Home / Net / Post-Deductions', a.takeHome!),
      row('totalComp', 'Total compensation', a.totalComp),
    ]),
    group('taxes', 'Taxes', incomeColors.taxes, a.taxes!, [
      row('federal', 'Federal income tax', a.federalTax!),
      row('state', 'State income tax', a.stateTax!),
      row('local', 'Local income tax', a.localTax!),
      row('socialSecurity', 'Social Security', a.socialSecurity!),
      row('medicare', 'Medicare', a.medicare!),
    ]),
    group(
      'pre',
      'Before-tax deductions',
      financial.deductions,
      a.traditional401k + a.otherPreTaxDeductions + payrollHsa,
      [
        row('traditional401k', 'Traditional 401(k)', a.traditional401k),
        row('payrollHsa', 'Payroll HSA', payrollHsa),
        ...deductions(true),
      ],
    ),
    group(
      'post',
      'After-tax contributions and deductions',
      financial.deductions,
      a.roth401k + a.traditionalIra + a.rothIra + a.otherPostTaxDeductions + a.hsa - payrollHsa,
      [
        row('roth401k', 'Roth 401(k)', a.roth401k),
        row(
          'traditionalIra',
          'Traditional IRA',
          a.traditionalIra,
          result.breakdown.find((r) => r.id === 'traditionalIra')?.note,
        ),
        row('rothIra', 'Roth IRA', a.rothIra, result.breakdown.find((r) => r.id === 'rothIra')?.note),
        row('outsideHsa', 'Outside-payroll HSA', a.hsa - payrollHsa),
        ...deductions(false),
      ],
    ),
    group(
      'employer',
      'Employer retirement contributions',
      financial.employerRetirement,
      a.employerMatch + a.employerOtherContribution,
      [
        row('match', 'Employer 401(k) match', a.employerMatch),
        row(
          'employerOther',
          input.employerOtherContributionName || 'Other employer retirement',
          a.employerOtherContribution,
        ),
      ],
    ),
    group('savings', 'Savings', incomeColors.savings, a.savings!, [row('savings', 'Savings', a.savings!)]),
    group('investments', 'Investments', incomeColors.investments, a.investments!, [
      row('investments', 'Investments', a.investments!),
    ]),
    group('spending', 'Spendable income', incomeColors.spending, a.spendable!, [
      row('spendable', 'Available after taxes, contributions and allocations', a.spendable!),
    ]),
  ];
}
