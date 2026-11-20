export interface InvestmentChartPoint {
  date: string;
  values: Record<string, number | null>;
  note?: string;
}
export interface InvestmentChartSeries {
  key: string;
  label: string;
  color: string;
}
export interface InvestmentChartEvent {
  date: string;
  label: string;
}

/** Keep unavailable observations null: D3 splits the path at those observations. */
export function chartNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function withinRange<T extends { date: string }>(points: T[], from: string, through: string): T[] {
  return points.filter((point) => point.date.slice(0, 10) >= from && point.date.slice(0, 10) <= through);
}

export function aggregateIncome(
  payments: { date: string; amount: string | number; reinvested?: boolean }[],
  aggregation: string,
): InvestmentChartPoint[] {
  const buckets = new Map<string, InvestmentChartPoint>();
  for (const payment of payments) {
    const date = payment.date.slice(0, 10);
    const month = Number(date.slice(5, 7));
    const key =
      aggregation === 'yearly'
        ? `${date.slice(0, 4)}-01-01`
        : aggregation === 'quarterly'
          ? `${date.slice(0, 4)}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
          : `${date.slice(0, 7)}-01`;
    const point = buckets.get(key) ?? { date: key, values: { cash: 0, reinvested: 0 } };
    const series = payment.reinvested ? 'reinvested' : 'cash';
    point.values[series] = (point.values[series] ?? 0) + Number(payment.amount);
    buckets.set(key, point);
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}
