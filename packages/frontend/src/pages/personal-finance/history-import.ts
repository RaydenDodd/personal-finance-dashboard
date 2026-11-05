import type { HistoryImportPayload, HistoryImportRecord } from '@/api/personal-finance';
import Papa from 'papaparse';

export interface UnmappedHistoryRecord extends Omit<HistoryImportRecord, 'accountId'> {
  accountId?: string;
  accountName: string;
}

// A date is an actual recorded date, never a generated month-start placeholder.
export function isRecordedDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseHistoryFile(
  text: string,
  fileName: string,
): { sourceId: string; records: UnmappedHistoryRecord[]; skippedBlank: number } {
  let rows: Record<string, unknown>[];
  let sourceId = `file:${fileName}`;
  if (/\.json$/i.test(fileName)) {
    const parsed = JSON.parse(text) as
      | { sourceId?: string; records?: Record<string, unknown>[] }
      | Record<string, unknown>[];
    if (Array.isArray(parsed)) rows = parsed;
    else {
      if (!Array.isArray(parsed.records)) throw new Error('JSON must contain a records array.');
      rows = parsed.records;
      if (parsed.sourceId) sourceId = parsed.sourceId;
    }
  } else {
    const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: 'greedy' });
    if (parsed.errors.length) throw new Error(`CSV could not be read: ${parsed.errors[0]!.message}`);
    rows = parsed.data;
    const sourceIds = [...new Set(rows.map((row) => String(row.sourceId ?? '').trim()).filter(Boolean))];
    if (sourceIds.length > 1)
      throw new Error('CSV contains multiple source identities; import each source separately.');
    if (sourceIds.length === 1) sourceId = sourceIds[0]!;
  }
  let skippedBlank = 0;
  const records: UnmappedHistoryRecord[] = [];
  rows.forEach((row, index) => {
    const rawBalance = row.balance;
    if (rawBalance === null || rawBalance === undefined || String(rawBalance).trim() === '') {
      skippedBlank++;
      return;
    }
    const balanceText = String(rawBalance)
      .replace(/[$,\s]/g, '')
      .replace(/^\((.+)\)$/, '-$1');
    const balance = Number(balanceText);
    if (!balanceText || !Number.isFinite(balance)) throw new Error(`Row ${index + 1}: balance must be a number.`);
    const date = String(row.date ?? '');
    if (!isRecordedDate(date)) throw new Error(`Row ${index + 1}: use the actual recorded date in YYYY-MM-DD format.`);
    const accountName = String(row.accountName ?? row.account ?? row.sourceLabel ?? '').trim();
    const accountId = typeof row.accountId === 'string' ? row.accountId : undefined;
    if (!accountName && !accountId) throw new Error(`Row ${index + 1}: account or accountName is required.`);
    const currencyCode = String(row.currencyCode ?? row.currency ?? 'USD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error(`Row ${index + 1}: invalid currency code.`);
    records.push({
      accountName: accountName || accountId!,
      accountId,
      date,
      balance,
      currencyCode,
      sourceKey: String(row.sourceKey ?? `${accountName || accountId}:${date}`),
      sourceLabel: String(row.sourceLabel ?? accountName),
      ...(typeof row.formula === 'string' && row.formula ? { formula: row.formula } : {}),
      verified: row.verified === true || row.verified === 'true',
    });
  });
  if (!records.length) throw new Error('No nonblank account balances were found.');
  return { sourceId, records, skippedBlank };
}

export function mapHistoryRecords(
  sourceId: string,
  records: UnmappedHistoryRecord[],
  mapping: Record<string, string>,
): HistoryImportPayload {
  const mapped: HistoryImportRecord[] = [];
  records.forEach(({ accountName, accountId, ...record }) => {
    const target = mapping[accountName] ?? accountId;
    if (target === '__skip__') return;
    if (!target) throw new Error(`Map the historical account “${accountName}” before previewing.`);
    mapped.push({ ...record, accountId: target });
  });
  if (!mapped.length) throw new Error('Map at least one account to import.');
  return { sourceId, records: mapped };
}
