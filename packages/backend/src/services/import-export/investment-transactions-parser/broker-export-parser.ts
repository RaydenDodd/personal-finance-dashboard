import { Big } from 'big.js';
import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';

export type BrokerExportKind = 'trade' | 'dividend' | 'cash' | 'interest' | 'fee' | 'review' | 'notice';
export interface BrokerExportEvent {
  sourceRowId: string;
  rowNumber: number;
  broker: 'robinhood' | 'm1';
  date: string;
  kind: BrokerExportKind;
  action: string;
  symbol: string | null;
  quantity: string | null;
  reportedPrice: string | null;
  /** Actual signed cash in the source. Null means the source does not provide cash. */
  cashAmount: string | null;
  description: string;
  issue: string | null;
}
export interface BrokerExportResult {
  broker: 'robinhood' | 'm1';
  fileHash: string;
  events: BrokerExportEvent[];
  issues: string[];
  hasCompleteHoldings: false;
}

function dateOnly(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
  )
    return null;
  return date.toISOString().slice(0, 10);
}

export function brokerDecimal(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  let value = raw.trim();
  const negative = /^\(.*\)$/.test(value);
  value = value.replace(/[,$\s()]/g, '');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(value)) return null;
  const parsed = new Big(value);
  return (negative ? parsed.abs().neg() : parsed).toString();
}

/**
 * Parse source events without inventing missing executions, share counts, prices or basis.
 * IDs are stable across equivalent/overlapping exports; occurrence keeps identical legitimate rows.
 */
export function parseBrokerPortfolioExport({
  fileContent,
  accountKey,
}: {
  fileContent: string;
  accountKey: string;
}): BrokerExportResult {
  if (!accountKey.trim()) throw new Error('An explicit source account key is required');
  const rows = parse(fileContent, { bom: true, skip_empty_lines: true, relax_column_count: true }) as string[][];
  const headers = rows[0]?.map((cell) => cell.trim());
  const broker =
    headers?.includes('Trans Code') && headers.includes('Activity Date')
      ? 'robinhood'
      : headers?.join('|') === 'Date|Activity|Value|Summary'
        ? 'm1'
        : null;
  if (!broker || !headers) throw new Error('Unsupported broker export columns');
  const events: BrokerExportEvent[] = [],
    issues: string[] = [];
  const occurrences = new Map<string, number>();
  for (const [index, raw] of rows.slice(1).entries()) {
    const get = (column: string) => (raw[headers.indexOf(column)] ?? '').trim();
    const date = dateOnly(get(broker === 'robinhood' ? 'Activity Date' : 'Date'));
    if (!date) {
      issues.push(`Row ${index + 2}: missing/invalid source date`);
      continue;
    }
    const action = get(broker === 'robinhood' ? 'Trans Code' : 'Activity');
    let symbol =
      broker === 'robinhood' ? get('Instrument') || null : (get('Summary').match(/^([A-Z][A-Z0-9.-]*)\s/)?.[1] ?? null);
    const description = get(broker === 'robinhood' ? 'Description' : 'Summary') || action;
    const quantity = broker === 'robinhood' ? brokerDecimal(get('Quantity')) : null;
    const reportedPrice = broker === 'robinhood' ? brokerDecimal(get('Price')) : null;
    const cashAmount = brokerDecimal(get(broker === 'robinhood' ? 'Amount' : 'Value'));
    let kind: BrokerExportKind = 'review',
      issue: string | null = null;
    if (broker === 'robinhood') {
      if (['Buy', 'Sell'].includes(action)) {
        if (
          !symbol ||
          !quantity ||
          new Big(quantity).lte(0) ||
          reportedPrice === null ||
          new Big(reportedPrice).lte(0) ||
          cashAmount === null
        ) {
          issue = 'Trade lacks a valid symbol, quantity, price or reported cash amount';
        } else if (
          (action === 'Buy' && new Big(cashAmount).gte(0)) ||
          (action === 'Sell' && new Big(cashAmount).lte(0))
        ) {
          issue = 'Trade cash direction is missing or conflicts with its action; no execution/basis inferred';
        } else if (/\b(?:Call|Put)\b/i.test(description) || /\d{6}[CP]\d{8}/.test(symbol)) {
          issue = 'Options require contract multipliers and are not imported as stock shares';
        } else kind = 'trade';
      } else if (action === 'CDIV' && symbol && cashAmount !== null && new Big(cashAmount).gt(0)) kind = 'dividend';
      else if (['ACH', 'FUTSWP', 'INT', 'SLIP'].includes(action) && cashAmount !== null) {
        kind = ['INT', 'SLIP'].includes(action) ? 'interest' : 'cash';
      } else issue = 'Corporate action, stock transfer, tax, reversal or unsupported activity requires review';
    } else {
      if (/^(Morning|Afternoon) Trading$/.test(action)) {
        kind = 'notice';
        issue = 'Trading summary contains no executed security, quantity or price';
      } else if (action === 'Deposit' && cashAmount !== null) kind = 'cash';
      else if (action === 'Dividend' && symbol && cashAmount !== null && new Big(cashAmount).gt(0)) kind = 'dividend';
      else if (action === 'Security Lending Interest' && cashAmount !== null) kind = 'interest';
      else if (action === 'M1 Borrow bill payment' && cashAmount !== null) kind = 'fee';
      else issue = 'Incomplete position activity or dividend correction requires review; no quantity/basis inferred';
    }
    symbol = symbol?.toUpperCase() ?? null;
    const identity = JSON.stringify([
      broker,
      accountKey,
      date,
      action,
      symbol,
      quantity,
      reportedPrice,
      cashAmount,
      description,
    ]);
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    const sourceRowId = createHash('sha256')
      .update(identity + '\n' + occurrence)
      .digest('hex');
    events.push({
      sourceRowId,
      rowNumber: index + 2,
      broker,
      date,
      kind,
      action,
      symbol,
      quantity,
      reportedPrice,
      cashAmount,
      description,
      issue,
    });
  }
  if (broker === 'm1')
    issues.push(
      'M1 activity summary has no executed trades or opening/current holdings. Holdings, cost basis and total investment returns cannot be reconstructed.',
    );
  if (events.some((event) => event.kind === 'review'))
    issues.push('Unsupported corporate/position activity remains in review and can make affected holdings incomplete.');
  return {
    broker,
    fileHash: createHash('sha256').update(fileContent).digest('hex'),
    events,
    issues,
    hasCompleteHoldings: false,
  };
}

/** Block entire affected symbols rather than replay incomplete trades into made-up holdings. */
export function brokerSymbolsNeedingReview(events: BrokerExportEvent[]): string[] {
  const blocked = new Set(
    events.filter((event) => event.kind === 'review' && event.symbol).map((event) => event.symbol!),
  );
  const quantities = new Map<string, Big>();
  for (const event of events.toSorted((a, b) => a.date.localeCompare(b.date) || b.rowNumber - a.rowNumber)) {
    if (event.kind !== 'trade' || !event.symbol || !event.quantity) continue;
    const change = new Big(event.quantity).times(event.action === 'Sell' ? -1 : 1);
    const next = (quantities.get(event.symbol) ?? new Big(0)).plus(change);
    quantities.set(event.symbol, next);
    if (next.lt(0)) blocked.add(event.symbol);
  }
  return [...blocked].toSorted();
}
