import { FINANCIAL_COLORS } from '@bt/shared/financial-colors';
import type { GetInvestmentContributionsResponse, GetPivotReportResponse } from '@bt/shared/types';
import type { PayrollDashboard } from '@bt/shared/types/payroll';

export interface CalendarEntry {
  id: string;
  date: string;
  group: string;
  label: string;
  amount: number;
  currency: string;
  color: string;
  note?: string;
}
export interface FundingCalendarResponse {
  investments: GetInvestmentContributionsResponse;
  currencyCode: string;
  savings: { id: string; date: string; label: string; amount: number; currency: string; note: string }[];
  savingsAvailable: boolean;
}

export const calendarRoles = [
  { group: 'Income', color: FINANCIAL_COLORS.income },
  { group: 'Investments', color: FINANCIAL_COLORS.investments },
  { group: 'Savings', color: FINANCIAL_COLORS.savings },
];

export function monthBounds(month: string) {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { from: month + '-01', to: month + '-' + String(count).padStart(2, '0') };
}

export function monthCells(month: string) {
  const { from, to } = monthBounds(month);
  const first = new Date(from + 'T12:00:00Z').getUTCDay();
  return [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: Number(to.slice(-2)) }, (_, i) => ({
      day: i + 1, date: month + '-' + String(i + 1).padStart(2, '0'),
    })),
  ];
}

export function fundingEntries(payroll?: PayrollDashboard, funding?: FundingCalendarResponse): CalendarEntry[] {
  const pay = (payroll?.statements ?? []).filter((row) =>
    Number.isFinite(row.totals.net) && row.totals.net !== 0 && !row.incompleteFields?.includes('net'),
  ).map((row) => ({
    id: 'pay:' + row.id, date: row.payDate.slice(0, 10), group: 'Income',
    label: payroll?.employments.find((job) => job.id === row.employmentId)?.employerName ?? 'Paycheck',
    amount: row.totals.net, currency: row.currency, color: FINANCIAL_COLORS.income,
    note: 'Recorded take-home pay',
  }));
  const investments = (funding?.investments.buckets ?? []).flatMap((bucket) =>
    bucket.byPortfolio.filter((row) => row.amount !== 0 && !!funding?.currencyCode).map((row) => ({
      id: 'invest:' + bucket.periodStart + ':' + row.portfolioId, date: bucket.periodStart, group: 'Investments',
      label: funding?.investments.portfolios.find((p) => p.portfolioId === row.portfolioId)?.name ?? 'Portfolio',
      amount: row.amount, currency: funding!.currencyCode, color: FINANCIAL_COLORS.investments,
      note: 'Net external portfolio funding',
    })),
  );
  const savings = (funding?.savings ?? []).map((row) => ({
    ...row, id: 'save:' + row.id, group: 'Savings', color: FINANCIAL_COLORS.savings,
  }));
  return [...pay, ...investments, ...savings];
}

export function spendingEntries(report?: GetPivotReportResponse): CalendarEntry[] {
  if (!report?.currencyCode) return [];
  return report.rows.filter((row) => row.kind !== 'child').flatMap((row) =>
    report.columns.flatMap((column) => {
      const amount = row.values[column.key] ?? 0;
      return amount === 0 ? [] : [{
        id: column.key + ':' + row.id, date: column.periodStart, group: row.label, label: row.label,
        amount, currency: report.currencyCode, color: row.color && /^#[0-9a-f]{6}$/i.test(row.color) && row.color !== '#000000'
          ? row.color : '#94A3B8',
      }];
    }),
  );
}

/** Signed totals for labels; color widths represent absolute activity, not net wealth. */
export function summarizeDay(entries: CalendarEntry[]) {
  const groups = new Map<string, { group: string; currency: string; color: string; amount: number; activity: number }>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.group, entry.currency, entry.color]);
    const group = groups.get(key) ?? { group: entry.group, currency: entry.currency, color: entry.color, amount: 0, activity: 0 };
    group.amount += entry.amount;
    group.activity += Math.abs(entry.amount);
    groups.set(key, group);
  }
  const values = [...groups.values()].sort((a, b) => b.activity - a.activity || a.group.localeCompare(b.group));
  const currencies = new Set(values.map((row) => row.currency));
  const totalActivity = values.reduce((sum, row) => sum + row.activity, 0);
  // Different currencies cannot be compared numerically without exchange-rate evidence.
  return values.map((row) => ({
    ...row, width: currencies.size > 1 ? 100 / values.length : totalActivity ? row.activity / totalActivity * 100 : 0,
  }));
}
