import Big from 'big.js';

import { percent } from './math';

/** Daily attribution from native positions and net trade cash, independent of tax-lot gains. */
export function dailyPositionChange(input: {
  quantity: string;
  marketValue: string;
  previousClose: string;
  trades: { category: string; quantity: string; amount: string }[];
}): { change: string; capital: string; percent: string | null } | null {
  let opening = new Big(input.quantity),
    netPurchases = new Big(0),
    purchases = new Big(0);
  for (const t of input.trades) {
    if (t.category !== 'buy' && t.category !== 'sell') continue;
    const direction = t.category === 'buy' ? 1 : -1;
    opening = opening.minus(new Big(t.quantity).times(direction));
    netPurchases = netPurchases.plus(new Big(t.amount).times(direction));
    if (direction === 1) purchases = purchases.plus(t.amount);
  }
  if (opening.lt(0)) return null;
  const openingValue = opening.times(input.previousClose);
  const change = new Big(input.marketValue).minus(openingValue).minus(netPurchases).toString();
  const capital = openingValue.plus(purchases).toString();
  return { change, capital, percent: percent(change, capital) };
}
