// MoneyMatter customization, AGPL-3.0-only. Values are read, never formulas executed.
const CATEGORY_BY_ROW = {
  4: 'spendable', 5: 'savings', 6: 'savings', 7: 'spendable', 8: 'savings',
  9: 'investments', 10: 'retirement', 11: 'investments', 12: 'retirement',
  13: 'retirement', 14: 'investments', 15: 'investments', 16: 'spendable',
  17: 'spendable', 18: 'retirement', 19: 'retirement',
};

export function sheetsDate(serial) {
  if (!Number.isFinite(serial) || serial < 1 || serial > 200000) throw new Error('Invalid Sheets date serial');
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
}

export function normalizeNetworthSheet(workbook, { fetchedAt = new Date().toISOString() } = {}) {
  const sheet = workbook.sheets?.find(s => s.properties?.title === 'Networth Calculator');
  if (!sheet || !workbook.spreadsheetId) throw new Error('Expected the Networth Calculator tab and spreadsheetId');
  const grid = new Map();
  for (const block of sheet.data || []) {
    for (const [ri, row] of (block.rowData || []).entries()) {
      for (const [ci, value] of (row.values || []).entries()) {
        grid.set(`${(block.startRow || 0) + ri + 1}:${(block.startColumn || 0) + ci + 1}`, value);
      }
    }
  }
  const cell = (r, c) => grid.get(`${r}:${c}`) || {};
  if (cell(3, 1).formattedValue?.trim().toLowerCase() !== 'date') throw new Error('Expected recorded dates in row 3');
  const accounts = [], records = [], warnings = new Set();
  const columnCount = sheet.properties.gridProperties?.columnCount || 57;
  for (let r = 4; r <= 19; r++) {
    const name = (cell(r, 1).effectiveValue?.stringValue || cell(r, 1).formattedValue || '').trim();
    if (!name) continue;
    const key = `sheet-row-${r}`;
    const combined = [4, 5, 6, 7, 8].includes(r);
    accounts.push({ key, name, categoryId: CATEGORY_BY_ROW[r], currencyCode: 'USD', included: true,
      balanceKind: 'asset', historical: true, combined,
      ...(combined ? {note: 'Historical worksheet row may combine or rename underlying accounts. Preserve as recorded; map/split only with dated evidence.'} : {}),
    });
    for (let c = 2; c <= columnCount; c++) {
      const input = cell(r, c);
      const balance = input.effectiveValue?.numberValue;
      if (input.effectiveValue?.errorValue) warnings.add(`Skipped R${r}C${c}: formula error requires review.`);
      if (balance === undefined || !Number.isFinite(balance)) continue;
      const serial = cell(3, c).effectiveValue?.numberValue;
      if (!serial) { warnings.add(`Skipped R${r}C${c}: balance without a recorded date.`); continue; }
      const date = sheetsDate(serial);
      const headerYear = cell(1, c).effectiveValue?.numberValue;
      if (headerYear && Number(date.slice(0, 4)) !== headerYear) {
        warnings.add(`R3C${c}: recorded date year differs from year header; actual recorded date preserved.`);
      }
      records.push({ sourceKey: `sheet:${sheet.properties.sheetId}:R${r}C${c}`, accountKey: key,
        accountName: name, date, balance, currencyCode: 'USD',
        sourceLabel: 'Google Sheets / Networth Calculator (manually maintained)',
        ...(input.userEnteredValue?.formulaValue ? {formula: input.userEnteredValue.formulaValue} : {}), verified: true });
    }
  }
  return { version: 1, sourceId: `google-sheets:${workbook.spreadsheetId}:${sheet.properties.sheetId}`,
    sheetName: sheet.properties.title, fetchedAt, accounts, records, warnings: [...warnings],
    notes: ['Only account rows 4–19 are imported. Work checkbox and summary/category totals are excluded.',
      'Blank cells remain missing; recorded zero balances are retained. Contributions are never inferred.',
      'Combined historical rows must not overlap with their component accounts in the same net-worth period.',
      'Recorded date serials take precedence over year/month display headings.'] };
}
