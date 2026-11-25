import type { InvestmentHolding } from '@bt/shared/types/investment-analytics';
import Big from 'big.js';

import { percent } from './math';

export { positionPeriodDates } from '@bt/shared/types/investment-position-periods';

/** Read adapter over the native replay and net settlement cash; no tax-lot calculation. */
export function positionPeriodReturns(input: {
  holding: InvestmentHolding;
  dates: Record<string, string>;
  onGain?: (period: string, gain: string, capital: string) => void;
  through?: string;
  openingValue: (portfolioId: string, securityId: string, date: string) => string | null;
  positionQuantity?: (portfolioId: string, securityId: string, date: string) => string | null;
  shareUnitFactor?: (securityId: string, date: string) => number;
  trades: {
    securityId: string;
    portfolioId: string;
    date: string;
    category: string;
    amount: string;
    quantity?: string;
  }[];
}) {
  const result: NonNullable<InvestmentHolding['personalReturns']> = {};
  const h = input.holding;
  const accounts = new Set(h.accounts.map((a) => a.portfolioId));
  const holdingTrades = input.trades.filter((t) => t.securityId === h.securityId && accounts.has(t.portfolioId));
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
    const periodTrades = holdingTrades.filter(
      (t) =>
        t.date > date &&
        (period !== 'custom' || !input.through || t.date <= input.through),
    );
    if (periodTrades.some((t) => t.category === 'transfer' && Number(t.quantity ?? 0) !== 0)) {
      result[key] = null;
      continue;
    }
    if (input.positionQuantity) {
      const matches = h.accounts.every((a) => {
        const start = input.positionQuantity!(a.portfolioId, h.securityId, date);
        const end =
          period === 'custom' && input.through
            ? input.positionQuantity!(a.portfolioId, h.securityId, input.through)
            : a.quantity;
        if (start == null || end == null) return false;
        let expected = new Big(start);
        for (const t of periodTrades.filter(
          (t) => t.portfolioId === a.portfolioId && (t.category === 'buy' || t.category === 'sell'),
        )) {
          if (t.quantity == null) return false;
          const quantity = new Big(t.quantity).times(input.shareUnitFactor?.(h.securityId, t.date) ?? 1);
          expected = t.category === 'buy' ? expected.plus(quantity) : expected.minus(quantity);
        }
        return expected.minus(end).abs().lte(new Big(end).abs().plus(1).times('0.000000001'));
      });
      if (!matches) {
        result[key] = null;
        continue;
      }
    }
    for (const t of periodTrades) {
      if (t.category === 'buy') {
        net = net.plus(t.amount);
        buys = buys.plus(t.amount);
      } else if (t.category === 'sell') net = net.minus(t.amount);
      else if (t.category === 'dividend') income = income.plus(t.amount);
      else if (t.category === 'fee' || t.category === 'tax') income = income.minus(t.amount);
    }
    const gain = new Big(ending).minus(opening).minus(net).plus(income).toString();
    result[key] = percent(gain, opening.plus(buys).toString());
    input.onGain?.(period, gain, opening.plus(buys).toString());
  }
  return result;
}
