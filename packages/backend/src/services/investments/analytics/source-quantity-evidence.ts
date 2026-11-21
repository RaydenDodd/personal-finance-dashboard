import type { TransactionRow } from '@services/stats/get-combined-balance-history/types';

import type { BrokerData } from '../broker-records/schema';

/** Read-only bridge from retained broker receipts into the native share replay.
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
    if (!['REC', 'SXCH', 'SPR', 'BCXL'].includes(action) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!key || seen.has(key) || transactions.some((t) => t.description?.includes(`[broker-row:${key}]`))) continue;
    seen.add(key);
    const cusip = String(e.description ?? '').match(/CUSIP:\s*([A-Z0-9]+)/)?.[1];
    const exact = cusip ? securities.filter((s) => s.cusip === cusip) : [];
    const matches = exact.length
      ? exact
      : securities.filter((s) => s.symbol === symbol && (!s.cusip || s.cusip === cusip));
    const receipt =
      action === 'REC' ||
      (action === 'SXCH' &&
        !(data.sourceEvents ?? []).some(
          (other) => other !== e && other.action === 'SXCH' && other.date === date && other.symbol === symbol,
        ));
    if (receipt && matches.length === 1 && e.quantity != null && Number(e.quantity) > 0) {
      rows.push({
        portfolioId,
        securityId: matches[0]!.id,
        date: new Date(date + 'T12:00:00Z'),
        category: 'transfer',
        transactionType: 'income',
        quantity: String(e.quantity),
        refAmount: '0',
        currencyCode: 'USD',
        settlementCurrencyCode: 'USD',
        settlementAmount: '0',
      } as TransactionRow);
    } else if (!matches.length || action === 'BCXL') {
      issues.push({
        date,
        symbol,
        action,
        reason: !matches.length
          ? 'Historical security identity / closing-price series is not registered.'
          : 'Cancellation requires a matching original trade; it has not been applied twice.',
      });
    }
  }
  return { rows, issues };
}
