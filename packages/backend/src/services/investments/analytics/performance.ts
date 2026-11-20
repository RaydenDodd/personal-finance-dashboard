import Big from 'big.js';
import xirr from 'xirr';

/** Price-only changes from persisted closes; sparse/stale baselines remain unavailable. */
export function recordedPriceReturns(points: { date: string; price: string }[], now = new Date()) {
  const result: Record<'daily' | 'weekly' | 'monthly' | 'ytd' | '1y', string | null> = {
    daily: null,
    weekly: null,
    monthly: null,
    ytd: null,
    '1y': null,
  };
  const sorted = points.toSorted((a, b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1);
  if (!latest || now.getTime() - new Date(latest.date).getTime() > 4 * 86400000) return result;
  const end = new Date(latest.date);
  const day = end.toISOString().slice(0, 10);
  const previous = sorted.findLast((p) => p.date.slice(0, 10) < day);
  const change = (p: typeof latest | undefined) =>
    !p || new Big(p.price).lte(0) ? null : new Big(latest.price).div(p.price).minus(1).times(100).toFixed(6);
  if (previous && end.getTime() - new Date(previous.date).getTime() <= 4 * 86400000) result.daily = change(previous);
  const weekly = new Date(end);
  weekly.setUTCDate(weekly.getUTCDate() - 7);
  const monthly = new Date(end);
  monthly.setUTCDate(1);
  monthly.setUTCMonth(monthly.getUTCMonth() - 1);
  monthly.setUTCDate(
    Math.min(end.getUTCDate(), new Date(Date.UTC(monthly.getUTCFullYear(), monthly.getUTCMonth() + 1, 0)).getUTCDate()),
  );
  const annual = new Date(end);
  annual.setUTCDate(1);
  annual.setUTCFullYear(annual.getUTCFullYear() - 1);
  annual.setUTCDate(
    Math.min(end.getUTCDate(), new Date(Date.UTC(annual.getUTCFullYear(), annual.getUTCMonth() + 1, 0)).getUTCDate()),
  );
  const ytd = new Date(Date.UTC(end.getUTCFullYear(), 0, 0));
  for (const [key, cutoff] of Object.entries({ weekly, monthly, ytd, '1y': annual })) {
    const target = cutoff.toISOString().slice(0, 10);
    const base = sorted.findLast((p) => p.date.slice(0, 10) <= target);
    if (base && cutoff.getTime() - new Date(base.date).getTime() <= 4 * 86400000)
      result[key as keyof typeof result] = change(base);
  }
  return result;
}

/** Exact valuation boundaries: a flow requires observations immediately before and after it. */
export interface ReturnBoundary {
  date: string;
  beforeFlow: string | null;
  afterFlow: string | null;
  externalFlow: string;
}
export function consolidatedReturns(boundaries: ReturnBoundary[], complete: boolean) {
  const unavailable = { twr: null, xirr: null, annualized: null, volatility: null, maxDrawdown: null };
  if (!complete || boundaries.length < 2 || boundaries.some((p) => p.beforeFlow === null || p.afterFlow === null))
    return unavailable;
  const first = boundaries[0]!;
  const last = boundaries[boundaries.length - 1]!;
  const days = (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86400000;
  if (days <= 0 || new Big(first.afterFlow!).lte(0)) return unavailable;
  let factor = new Big(1);
  let previous = new Big(first.afterFlow!);
  let peak = new Big(1);
  let drawdown = new Big(0);
  const dailyReturns: number[] = [];
  let daily = true;
  for (let i = 1; i < boundaries.length; i++) {
    const point = boundaries[i]!;
    if (previous.lte(0)) return unavailable;
    // An exact before/after pair must reconcile to its actual external flow.
    if (new Big(point.afterFlow!).minus(point.beforeFlow!).minus(point.externalFlow).abs().gt('0.000001'))
      return unavailable;
    const ratio = new Big(point.beforeFlow!).div(previous);
    factor = factor.times(ratio);
    if (factor.gt(peak)) peak = factor;
    if (peak.gt(0)) {
      const dd = factor.div(peak).minus(1);
      if (dd.lt(drawdown)) drawdown = dd;
    }
    const interval = (new Date(point.date).getTime() - new Date(boundaries[i - 1]!.date).getTime()) / 86400000;
    if (interval !== 1) daily = false;
    dailyReturns.push(Number(ratio.minus(1)));
    previous = new Big(point.afterFlow!);
  }
  let irr: string | null = null;
  const flows = [
    { amount: -Number(first.afterFlow), when: new Date(first.date) },
    ...boundaries.slice(1).map((p) => ({ amount: -Number(p.externalFlow), when: new Date(p.date) })),
    { amount: Number(last.afterFlow), when: new Date(last.date) },
  ].filter((p) => p.amount !== 0);
  try {
    const n = xirr(flows);
    if (Number.isFinite(n)) irr = new Big(n).times(100).toFixed(6);
  } catch {
    /* no unique/convergent annualized IRR */
  }
  let volatility: string | null = null;
  if (daily && dailyReturns.length >= 30) {
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    volatility = new Big(
      Math.sqrt(dailyReturns.reduce((n, r) => n + (r - mean) ** 2, 0) / (dailyReturns.length - 1)) *
        Math.sqrt(365) *
        100,
    ).toFixed(6);
  }
  const annualized = days >= 365 && factor.gt(0) ? ((Number(factor) ** (365 / days) - 1) * 100).toFixed(6) : null;
  return {
    twr: factor.minus(1).times(100).toFixed(6),
    xirr: irr,
    annualized,
    volatility,
    maxDrawdown: drawdown.times(100).toFixed(6),
  };
}

/** Align actual observations to a common first date, never compare balance levels to index levels. */
export function normalizeComparableSeries(series: { id: string; points: { date: string; value: string }[] }[]) {
  if (!series.length) return [];
  const maps = series.map((s) => new Map(s.points.filter((p) => new Big(p.value).gt(0)).map((p) => [p.date, p.value])));
  const dates = [...maps[0]!.keys()].filter((d) => maps.every((m) => m.has(d))).sort();
  if (dates.length < 2) return series.map((s) => ({ id: s.id, points: [] }));
  return series.map((s, i) => ({
    id: s.id,
    points: dates.map((date) => ({
      date,
      returnPercent: new Big(maps[i]!.get(date)!).div(maps[i]!.get(dates[0]!)!).minus(1).times(100).toFixed(6),
    })),
  }));
}
