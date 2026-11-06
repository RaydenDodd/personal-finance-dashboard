import { createHash } from 'node:crypto';

export const HISTORY_CUTOFF = '2026-11-05';
export interface SheetCell {
  effectiveValue?: { numberValue?: number; stringValue?: string; errorValue?: unknown };
  userEnteredValue?: { numberValue?: number; stringValue?: string; formulaValue?: string };
  formattedValue?: string;
  note?: string;
}
export interface SheetGrid {
  sheetId: number;
  sheetName: string;
  columnCount: number;
  rowCount: number;
  cells: Map<string, SheetCell>;
}
export interface SheetMapping {
  accountId: string;
  balanceRow: number;
  principalRow?: number;
  expectedBalanceLabel?: string;
  expectedPrincipalLabel?: string;
}
export interface SheetSyncConfig {
  enabled: boolean;
  spreadsheetId: string;
  sheetName: string;
  sheetId: number;
  mirrorSimplefin: boolean;
  mappings: SheetMapping[];
  acceptedLegacyPrincipalCells?: Array<{ row: number; column: number; cents: number; note: string }>;
}
export function assertMappedRows(grid: SheetGrid, config: SheetSyncConfig): void {
  const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
  const label = (row: number) => {
    const cell = cellAt(grid, row, 1);
    return normalize(String(cell.effectiveValue?.stringValue ?? cell.userEnteredValue?.stringValue ?? ''));
  };
  for (const mapping of config.mappings)
    if (
      (mapping.expectedBalanceLabel && label(mapping.balanceRow) !== normalize(mapping.expectedBalanceLabel)) ||
      (mapping.principalRow &&
        mapping.expectedPrincipalLabel &&
        label(mapping.principalRow) !== normalize(mapping.expectedPrincipalLabel))
    )
      throw Error('sheet_mapping_changed');
}
export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const cellKey = (row: number, column: number) => `${row}:${column}`;
export const cellAt = (grid: SheetGrid, row: number, column: number) => grid.cells.get(cellKey(row, column)) ?? {};
export const cellCents = (cell: SheetCell): number | null => {
  const value = cell.effectiveValue?.numberValue ?? cell.userEnteredValue?.numberValue;
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : null;
};
export const cellFingerprint = (cell: SheetCell) =>
  fingerprint({ entered: cell.userEnteredValue ?? null, value: cellCents(cell), note: cell.note ?? '' });
export const blankCell = (cell: SheetCell) => !cell.userEnteredValue && !cell.effectiveValue && !cell.note;
export const dateSerial = (date: string) =>
  Math.round((Date.parse(date + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000);
const validDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  !Number.isNaN(Date.parse(date)) &&
  new Date(date).toISOString().slice(0, 10) === date;
export function headerDate(cell: SheetCell): string | null {
  const raw = cell.effectiveValue?.numberValue ?? cell.userEnteredValue?.numberValue;
  if (typeof raw === 'number' && raw >= 36526 && raw < 73415)
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86400000).toISOString().slice(0, 10);
  const text = (cell.effectiveValue?.stringValue ?? cell.formattedValue ?? '').trim();
  if (validDate(text)) return text;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const date = match ? `${match[3]}-${match[1]!.padStart(2, '0')}-${match[2]!.padStart(2, '0')}` : '';
  return validDate(date) ? date : null;
}
/** Only a fully specified date is authoritative. Yearless notes need review. */
export function contributionDate(note: string): string | null {
  const firstLine = /^(\d{1,2})\/(\d{1,2})\/(20\d{2})(?:\s|$)/.exec(note.trim());
  if (firstLine) {
    const date = `${firstLine[3]}-${firstLine[1]!.padStart(2, '0')}-${firstLine[2]!.padStart(2, '0')}`;
    if (validDate(date)) return date;
  }
  const explicit = /^(?:Contribution date:\s*|Date:\s*)?(20\d{2}-\d{2}-\d{2})(?:\s|$)/.exec(note.trim());
  if (explicit && validDate(explicit[1]!)) return explicit[1]!;
  const dates = new Set<string>();
  for (const match of note.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    if (validDate(date)) dates.add(date);
  }
  for (const match of note.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2}|20\d{2})\b/g)) {
    const year = match[3]!.length === 2 ? '20' + match[3] : match[3];
    const date = `${year}-${match[1]!.padStart(2, '0')}-${match[2]!.padStart(2, '0')}`;
    if (validDate(date)) dates.add(date);
  }
  for (const match of note.matchAll(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/gi,
  )) {
    const month =
      ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(
        match[1]!.slice(0, 3).toLowerCase(),
      ) + 1;
    const date = `${match[3]}-${String(month).padStart(2, '0')}-${match[2]!.padStart(2, '0')}`;
    if (validDate(date)) dates.add(date);
  }
  return dates.size === 1 ? [...dates][0]! : null;
}
export function dateColumns(grid: SheetGrid): Map<string, number> {
  const dates = new Map<string, number>();
  for (let column = 2; column <= grid.columnCount; column++) {
    const date = headerDate(cellAt(grid, 3, column));
    if (!date) continue;
    if (dates.has(date)) throw Error('duplicate_date_columns');
    dates.set(date, column);
  }
  return dates;
}
export function readGrid(data: any, sheetId: number): SheetGrid {
  const sheet = data.sheets?.find((item: any) => item.properties?.sheetId === sheetId);
  if (!sheet) throw Error('sheet_not_found');
  const cells = new Map<string, SheetCell>();
  for (const chunk of sheet.data ?? [])
    for (const [rowIndex, row] of (chunk.rowData ?? []).entries())
      for (const [columnIndex, cell] of (row.values ?? []).entries())
        cells.set(cellKey((chunk.startRow ?? 0) + rowIndex + 1, (chunk.startColumn ?? 0) + columnIndex + 1), cell);
  return {
    sheetId,
    sheetName: sheet.properties.title,
    columnCount: sheet.properties.gridProperties.columnCount,
    rowCount: sheet.properties.gridProperties.rowCount,
    cells,
  };
}
export function balanceDecision(input: {
  remoteCents: number | null;
  localCents: number | null;
  localSource?: string;
  remoteChanged: boolean;
  localChanged: boolean;
  hasBaseline: boolean;
  isFormula: boolean;
}): 'none' | 'pull' | 'push' | 'conflict' {
  const { remoteCents, localCents, remoteChanged, localChanged, hasBaseline, isFormula, localSource } = input;
  if (remoteCents === localCents) return 'none';
  if (remoteCents === null) {
    if (localCents === null) return 'none';
    if (hasBaseline && remoteChanged) return 'conflict';
    return isFormula ? 'conflict' : 'push';
  }
  if (localCents === null) return 'pull';
  if (!hasBaseline) return ['google-sheets', 'csv'].includes(localSource ?? '') ? 'pull' : 'conflict';
  if (remoteChanged && localChanged) return 'conflict';
  if (remoteChanged) return 'pull';
  if (localChanged) return isFormula ? 'conflict' : 'push';
  return 'conflict';
}
export function writeCellRequest(grid: SheetGrid, row: number, column: number, value: number, note?: string) {
  return {
    updateCells: {
      range: {
        sheetId: grid.sheetId,
        startRowIndex: row - 1,
        endRowIndex: row,
        startColumnIndex: column - 1,
        endColumnIndex: column,
      },
      rows: [{ values: [{ userEnteredValue: { numberValue: value }, ...(note === undefined ? {} : { note }) }] }],
      fields: note === undefined ? 'userEnteredValue' : 'userEnteredValue,note',
    },
  };
}
export const contributionMarker = (note: string) => /MoneyMatter cash-flow:\s*([0-9a-f-]{36})/i.exec(note)?.[1] ?? null;
