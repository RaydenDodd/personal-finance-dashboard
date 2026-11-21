import { investmentPriceDate } from '@bt/shared/types/investment-market';
import type { TransactionRow } from '@services/stats/get-combined-balance-history/types';
import Big from 'big.js';

import type { BrokerSnapshot } from '../broker-records/schema';

/** Quantity observations, never synthetic purchases. Backward seeds begin at the first evidenced trade. */
export function positionEvidence(
  snapshots: BrokerSnapshot[],
  trades: TransactionRow[],
  factor: (id: string, date: string) => number,
) {
  const anchors = snapshots
    .filter((s) => s.positions?.length || (s.complete && Array.isArray(s.positions)))
    .map((s) => ({ ...s, opening: false, positions: s.positions ?? [] }));
  const openings: {
    asOf: string;
    opening: boolean;
    complete: boolean;
    positions: { securityId: string; quantity: string; costBasis: null }[];
  }[] = [];
  for (const id of new Set(trades.map((t) => t.securityId))) {
    const txs = trades.filter(
      (t) =>
        t.securityId === id &&
        ['buy', 'sell', 'transfer'].includes(t.category) &&
        (Number(t.quantity) !== 0 || t.quantityUnknown || t.cashInLieu),
    );
    const first = txs[0];
    if (
      !first ||
      !(first.category === 'sell' || (first.category === 'transfer' && first.transactionType === 'expense'))
    )
      continue;
    const anchor = anchors.find(
      (s) =>
        (s.complete || s.positions.some((p) => p.securityId === id)) &&
        investmentPriceDate(s.asOf) >= investmentPriceDate(first.date),
    );
    const position = anchor?.positions.find((p) => p.securityId === id);
    if (!anchor) continue;
    let opening = new Big(position?.quantity ?? '0').times(factor(id, investmentPriceDate(anchor.asOf)));
    let valid = true;
    for (const t of txs.filter((t) => new Date(t.date) <= new Date(anchor.asOf))) {
      if (t.quantityUnknown || t.cashInLieu || (t.category === 'transfer' && !t.transactionType)) {
        valid = false;
        break;
      }
      const qty = new Big(t.quantity).times(factor(id, investmentPriceDate(t.date)));
      opening =
        t.category === 'buy' || (t.category === 'transfer' && t.transactionType === 'income')
          ? opening.minus(qty)
          : opening.plus(qty);
    }
    if (valid && opening.gte(0))
      openings.push({
        asOf: investmentPriceDate(first.date) + 'T00:00:00Z',
        opening: true,
        complete: false,
        positions: [{ securityId: id, quantity: opening.toString(), costBasis: null }],
      });
  }
  return [...openings, ...anchors].sort((a, b) => a.asOf.localeCompare(b.asOf));
}
