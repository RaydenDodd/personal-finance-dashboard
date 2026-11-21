import type { TransactionRow } from '@services/stats/get-combined-balance-history/types';
import Big from 'big.js';

import type { BrokerData } from '../broker-records/schema';

/** Read-only bridge from retained broker records into the native share replay.
 * Never creates trades, cash, basis, or lots. Published splits remain in the native price normalization.
 */
export function sourceQuantityEvidence(
  portfolioId: string,
  data: BrokerData,
  securities: { id: string; symbol: string | null; cusip?: string | null }[],
  transactions: (TransactionRow & { description?: string | null })[],
) {
  const rows: TransactionRow[] = [];
  const issues: { date: string; symbol: string; action: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const e of data.sourceEvents ?? []) {
    const action = String(e.action ?? ''),
      date = String(e.date ?? ''),
      symbol = String(e.symbol ?? ''),
      key = String(e.sourceRowId ?? '');
    const trade = data.broker === 'robinhood' && ['Buy', 'Sell'].includes(action) && e.kind === 'trade';
    if ((!trade && !['REC', 'SXCH', 'SPR', 'BCXL', 'CIL'].includes(action)) || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      continue;
    if (!key || seen.has(key) || transactions.some((t) => t.description?.includes(`[broker-row:${key}]`))) continue;
    seen.add(key);
    const cusip = String(e.description ?? '').match(/CUSIP:\s*([A-Z0-9]+)/)?.[1];
    const exact = cusip ? securities.filter((s) => s.cusip === cusip) : [];
    const matches = exact.length
      ? exact
      : securities.filter((s) => s.symbol === symbol && (!s.cusip || s.cusip === cusip));
    const cil = action === 'CIL' ? String(e.description ?? '').match(/CIL on\s+([\d.]+)\s*@\s*\$?([\d.,]+)/i) : null;
    if (cil && matches.length === 1 && Number(e.cashAmount) > 0) {
      rows.push({
        portfolioId,
        securityId: matches[0]!.id,
        date: new Date(date + 'T12:00:00Z'),
        category: 'transfer',
        quantity: '0',
        refAmount: '0',
        currencyCode: 'USD',
        settlementCurrencyCode: 'USD',
        settlementAmount: '0',
        cashInLieu: { amount: String(e.cashAmount), quantity: cil[1]!, price: cil[2]!.replaceAll(',', '') },
        description: `[broker-row:${key}] retained CIL`,
      } as TransactionRow);
      continue;
    }
    const receipt =
      action === 'REC' ||
      (action === 'SXCH' &&
        !(data.sourceEvents ?? []).some(
          (other) => other !== e && other.action === 'SXCH' && other.date === date && other.symbol === symbol,
        ));
    const cancellation =
      action === 'BCXL' &&
      e.cashAmount != null &&
      Number(e.cashAmount) > 0 &&
      (data.sourceEvents ?? []).some(
        (original) =>
          original.action === 'Buy' &&
          original.date === date &&
          original.symbol === symbol &&
          original.quantity === e.quantity &&
          Number(original.cashAmount) === -Number(e.cashAmount),
      );
    const validTrade =
      trade &&
      e.cashAmount != null &&
      Number.isFinite(Number(e.cashAmount)) &&
      (action === 'Buy' ? Number(e.cashAmount) < 0 : Number(e.cashAmount) > 0);
    const unknownMovement =
      ['SPR', 'SXCH'].includes(action) &&
      e.quantity == null &&
      matches.length === 1 &&
      !(data.sourceEvents ?? []).some(
        (other) =>
          other.action === action && other.date === date && other.symbol === symbol && Number(other.quantity) > 0,
      );
    if (unknownMovement) {
      rows.push({
        portfolioId,
        securityId: matches[0]!.id,
        date: new Date(date + 'T12:00:00Z'),
        category: 'transfer',
        quantityUnknown: true,
        quantity: '0',
        refAmount: '0',
        currencyCode: 'USD',
        settlementCurrencyCode: 'USD',
        settlementAmount: '0',
        description: `[broker-row:${key}] unresolved ${action}`,
      } as TransactionRow);
      issues.push({
        date,
        symbol,
        action,
        reason:
          'The corporate action does not establish the post-action holding. Supply a dated post-action position or cash-in-lieu statement; later shares are not assumed.',
      });
      continue;
    }
    if (
      (receipt || validTrade || cancellation) &&
      matches.length === 1 &&
      e.quantity != null &&
      Number(e.quantity) > 0
    ) {
      const side = validTrade ? (action === 'Buy' ? 'buy' : 'sell') : cancellation ? 'sell' : 'transfer';
      const amount = side === 'transfer' ? '0' : new Big(String(e.cashAmount)).abs().toString();
      rows.push({
        portfolioId,
        securityId: matches[0]!.id,
        date: new Date(date + 'T12:00:00Z'),
        category: side,
        transactionType: side === 'buy' ? 'expense' : 'income',
        description: `[broker-row:${key}] retained ${action}`,
        quantity: String(e.quantity),
        refAmount: amount,
        currencyCode: 'USD',
        settlementCurrencyCode: 'USD',
        settlementAmount: amount,
      } as TransactionRow);
    } else if (!matches.length || action === 'BCXL') {
      issues.push({
        date,
        symbol,
        action,
        reason: !matches.length
          ? `No verified matching historical price identity${cusip ? ' for CUSIP ' + cusip : ''}. Supply dated broker values/prices or a verified issuer successor mapping.`
          : 'Cancellation requires a matching original trade; it has not been applied twice.',
      });
    }
  }
  return { rows, issues };
}
