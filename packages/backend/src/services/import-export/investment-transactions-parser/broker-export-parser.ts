import { Big } from 'big.js';
import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';

export type BrokerExportKind = 'trade' | 'dividend' | 'cash' | 'interest' | 'fee' | 'review' | 'notice';
export interface BrokerExportEvent {
  sourceRowId: string;
  rowNumber: number;
  broker: 'robinhood' | 'm1';
  date: string;
  postedDate?: string;
  securityId?: string;
  securityIdType?: string;
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

function m1DetailDate(raw: string): string | null {
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})$/.exec(raw.trim());
  if (!match) return null;
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(match[1]!) + 1;
  return dateOnly(month + '/' + match[2] + '/' + match[3]);
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
  const m1Detail = ['Date', 'Posted Date', 'Symbol', 'Description', 'Transaction Type', 'Amount', 'Units', 'Unit Type', 'Unit Price', 'Security Id', 'Security Id Type'].every((header) => headers?.includes(header));
  const broker =
    headers?.includes('Trans Code') && headers.includes('Activity Date')
      ? 'robinhood'
      : (m1Detail || headers?.join('|') === 'Date|Activity|Value|Summary')
        ? 'm1'
        : null;
  if (!broker || !headers) throw new Error('Unsupported broker export columns');
  const events: BrokerExportEvent[] = [],
    issues: string[] = [];
  const occurrences = new Map<string, number>();
  for (const [index, raw] of rows.slice(1).entries()) {
    const get = (column: string) => (raw[headers.indexOf(column)] ?? '').trim();
    const date = m1Detail ? m1DetailDate(get('Date')) : dateOnly(get(broker === 'robinhood' ? 'Activity Date' : 'Date'));
    const postedDate = m1Detail ? m1DetailDate(get('Posted Date')) : null;
    if (!date || (m1Detail && !postedDate)) {
      issues.push(`Row ${index + 2}: missing/invalid source date`);
      continue;
    }
    const sourceAction = get(m1Detail ? 'Transaction Type' : broker === 'robinhood' ? 'Trans Code' : 'Activity');
    const action = m1Detail && sourceAction === 'PURCHASED' ? 'Buy' : m1Detail && sourceAction === 'SOLD' ? 'Sell' : sourceAction;
    let symbol =
      m1Detail ? get('Symbol') || null : broker === 'robinhood' ? get('Instrument') || null : (get('Summary').match(/^([A-Z][A-Z0-9.-]*)\s/)?.[1] ?? null);
    const description = get(m1Detail || broker === 'robinhood' ? 'Description' : 'Summary') || action;
    const sourceQuantity = m1Detail ? brokerDecimal(get('Units')) : null;
    const quantity = m1Detail && sourceQuantity !== null ? new Big(sourceQuantity).abs().toString() : broker === 'robinhood' ? brokerDecimal(get('Quantity')) : null;
    const reportedPrice = m1Detail ? brokerDecimal(get('Unit Price')) : broker === 'robinhood' ? brokerDecimal(get('Price')) : null;
    const sourceCash = brokerDecimal(get(m1Detail || broker === 'robinhood' ? 'Amount' : 'Value'));
    // M1 detailed activity uses positive purchase cost and negative sale proceeds,
    // opposite the cash-ledger convention for these two actions only.
    const cashAmount = m1Detail && ['Buy', 'Sell'].includes(action) && sourceCash !== null ? new Big(sourceCash).neg().toString() : sourceCash;
    const securityId = m1Detail ? get('Security Id') : '';
    const securityIdType = m1Detail ? get('Security Id Type') : '';
    let kind: BrokerExportKind = 'review',
      issue: string | null = null;
    if (m1Detail) {
      if (['Buy', 'Sell'].includes(action)) {
        if (!symbol || !quantity || new Big(quantity).lte(0) || !reportedPrice || new Big(reportedPrice).lte(0) ||
            cashAmount === null || sourceQuantity === null || get('Unit Type') !== 'SHARES' ||
            (action === 'Buy' ? new Big(cashAmount).gte(0) || new Big(sourceQuantity).lte(0) : new Big(cashAmount).lte(0) || new Big(sourceQuantity).gte(0))) {
          issue = 'Trade lacks valid execution details or has conflicting source signs';
        } else kind = 'trade';
      } else if (sourceAction === 'TRANSFER' && cashAmount !== null && new Big(cashAmount).gt(0) && /^ACH deposit of .+ completed\.$/i.test(description)) {
        kind = 'cash';
      } else if (sourceAction === 'DIVIDEND' && symbol && cashAmount !== null && new Big(cashAmount).gt(0)) {
        kind = 'dividend';
      } else if (sourceAction === 'OTHER' && /^Securities lending interest of .+ received\.$/i.test(description) && cashAmount !== null && new Big(cashAmount).gt(0)) {
        kind = 'interest';
      } else if (['FEE', 'SRVCHG', 'MARGININTEREST'].includes(sourceAction) && cashAmount !== null && new Big(cashAmount).lt(0)) {
        kind = 'fee';
      } else issue = 'Unrecognized transfer, reversal, award, correction or unsupported activity requires review';
    } else if (broker === 'robinhood') {
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
      ...(m1Detail ? ['m1-detailed-v1', postedDate, securityId, securityIdType] : []),
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
      ...(m1Detail ? { postedDate: postedDate!, securityId, securityIdType } : {}),
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
  if (m1Detail) issues.push('Detailed M1 executions are available; complete opening positions, cash and corporate-action coverage are not established by this export. Reconcile overlapping sources before applying.');
  else if (broker === 'm1')
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
