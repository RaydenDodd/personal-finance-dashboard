import type { InvestmentAnalytics, InvestmentHolding } from '@bt/shared/types/investment-analytics';
import { investmentPriceDate } from '@bt/shared/types/investment-market';
import Big from 'big.js';

import { percent, sum } from './math';
import { consolidatedReturns, normalizeComparableSeries } from './performance';

/** Descriptive price risk of today's fixed quantities. No historical position or cash-flow claims. */
export function currentHoldingsPriceRisk(
  holdings: InvestmentHolding[],
  prices: { securityId: string; date: string; price: string }[],
  currency: string,
): NonNullable<InvestmentAnalytics['priceRisk']> {
  const maps = new Map<string, Map<string, string>>();
  for (const point of prices.toSorted((a, b) => a.date.localeCompare(b.date))) {
    const map = maps.get(point.securityId) ?? new Map<string, string>();
    map.set(investmentPriceDate(point.date), point.price);
    maps.set(point.securityId, map);
  }
  const candidates = holdings.filter(
    (h) =>
      h.currencyCode === currency &&
      h.marketValue !== null &&
      new Big(h.marketValue).gt(0) &&
      new Big(h.quantity).gt(0) &&
      (maps.get(h.id)?.size ?? 0) >= 2,
  );
  const latestDate = [...maps.values()]
    .flatMap((m) => [...m.keys()])
    .sort()
    .at(-1);
  const recentFrom = latestDate
    ? new Date(new Date(latestDate + 'T12:00:00Z').getTime() - 14 * 86400000).toISOString().slice(0, 10)
    : '';
  const recent = candidates.filter((h) => [...maps.get(h.id)!.keys()].filter((d) => d >= recentFrom).length >= 2);
  const seasoned = recent.filter((h) => maps.get(h.id)!.size >= 31);
  const included = seasoned.length ? seasoned : recent;
  const dates = included.length
    ? [...maps.get(included[0]!.id)!.keys()].filter((d) => included.every((h) => maps.get(h.id)!.has(d))).sort()
    : [];
  const values = dates.map((date) => ({
    date,
    value: sum(included.map((h) => new Big(h.quantity).times(maps.get(h.id)!.get(date)!).toString()))!,
  }));
  const normalized = normalizeComparableSeries([{ id: 'basket', points: values }])[0]?.points ?? [];
  const stats = consolidatedReturns(
    values.map((p) => ({ date: p.date, beforeFlow: p.value, afterFlow: p.value, externalFlow: '0' })),
    true,
  );
  let peak = 1;
  const points = normalized.map((p) => {
    const level = 1 + Number(p.returnPercent) / 100;
    peak = Math.max(peak, level);
    return { ...p, drawdown: ((level / peak - 1) * 100).toFixed(6) };
  });
  const returns = values.slice(1).map((p, i) => Number(new Big(p.value).div(values[i]!.value).minus(1)));
  const mean = returns.reduce((n, r) => n + r, 0) / returns.length;
  const volatility =
    returns.length >= 30
      ? (
          Math.sqrt(returns.reduce((n, r) => n + (r - mean) ** 2, 0) / (returns.length - 1)) *
          Math.sqrt(252) *
          100
        ).toFixed(6)
      : null;
  return {
    points,
    coveragePercent:
      percent(
        sum(included.map((h) => h.marketValue)),
        sum(holdings.filter((h) => h.marketValue !== null).map((h) => h.marketValue)),
      ) ?? '0',
    included: included.length,
    excluded: holdings.filter((h) => !included.includes(h)).map((h) => h.symbol),
    volatility,
    maxDrawdown: stats.maxDrawdown,
    methodology:
      'Price-only fixed basket of current quantities, using actual common dated prices. This is current-holdings price risk, not historical account performance. Cash, trades, distributions, unpriced holdings and instruments without sufficiently recent history are excluded. Volatility uses observed trading dates and 252 sessions per year.',
  };
}
