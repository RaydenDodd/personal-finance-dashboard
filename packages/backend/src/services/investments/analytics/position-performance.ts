import type { InvestmentHolding } from '@bt/shared/types/investment-analytics';
import Big from 'big.js';

import { percent } from './math';

export function positionPeriodDates(today: string) {
  const end = new Date(today + 'T12:00:00Z');
  const monthly = (months: number) => {
    const date = new Date(end);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - months);
    date.setUTCDate(Math.min(day, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()));
    return date.toISOString().slice(0, 10);
  };
  const week = new Date(end);
  week.setUTCDate(week.getUTCDate() - 7);
  return {
    weekly: week.toISOString().slice(0, 10),
    monthly: monthly(1),
    '3m': monthly(3),
    '6m': monthly(6),
    ytd: new Date(Date.UTC(end.getUTCFullYear(), 0, 0)).toISOString().slice(0, 10),
    '1y': monthly(12),
    '2y': monthly(24),
    '5y': monthly(60),
  };
}

/** Read adapter over the native replay and net settlement cash; no tax-lot calculation. */
export function positionPeriodReturns(input: {
  holding: InvestmentHolding;
  dates: Record<string, string>;
  through?: string;
  openingValue: (portfolioId: string, securityId: string, date: string) => string | null;
  trades: { securityId: string; portfolioId: string; date: string; category: string; amount: string }[];
}) {
  const result: NonNullable<InvestmentHolding['personalReturns']> = {};
  const h = input.holding;
  for (const [period, date] of Object.entries(input.dates)) {
    const key = period as keyof typeof result;
    const values = h.accounts.map((a) => input.openingValue(a.portfolioId, h.securityId, date));
    const endValues =
      period === 'custom' && input.through
        ? h.accounts.map((a) => input.openingValue(a.portfolioId, h.securityId, input.through!))
        : null;
    const ending = endValues
      ? endValues.some((v) => v === null)
        ? null
        : endValues.reduce<Big>((n, v) => n.plus(v!), new Big(0)).toString()
      : h.marketValue;
    if (ending === null || values.some((v) => v === null)) {
      result[key] = null;
      continue;
    }
    const opening = values.reduce<Big>((n, v) => n.plus(v!), new Big(0));
    let net = new Big(0),
      buys = new Big(0),
      income = new Big(0);
    for (const t of input.trades.filter(
      (t) =>
        t.securityId === h.securityId &&
        h.accounts.some((a) => a.portfolioId === t.portfolioId) &&
        t.date > date &&
        (period !== 'custom' || !input.through || t.date <= input.through),
    )) {
      if (t.category === 'buy') {
        net = net.plus(t.amount);
        buys = buys.plus(t.amount);
      } else if (t.category === 'sell') net = net.minus(t.amount);
      else if (t.category === 'dividend') income = income.plus(t.amount);
      else if (t.category === 'fee') income = income.minus(t.amount);
    }
    result[key] = percent(
      new Big(ending).minus(opening).minus(net).plus(income).toString(),
      opening.plus(buys).toString(),
    );
  }
  return result;
}
