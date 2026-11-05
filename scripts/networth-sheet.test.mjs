import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeNetworthSheet, sheetsDate } from './lib/networth-sheet.mjs';

function fixture() {
  const rows = Array.from({ length: 25 }, () => ({ values: [] }));
  const set = (r, c, v) => (rows[r - 1].values[c - 1] = v);
  const text = (value) => ({ formattedValue: value, effectiveValue: { stringValue: value } });
  const num = (value) => ({ effectiveValue: { numberValue: value } });
  set(1, 2, num(2023));
  set(3, 1, text('Date'));
  set(3, 2, num(44727));
  set(3, 3, num(44763));
  set(4, 1, text('Synthetic Checking'));
  set(4, 2, { ...num(125), userEnteredValue: { formulaValue: '=100+25' } });
  set(4, 3, num(0));
  set(5, 1, text('Synthetic Savings'));
  set(20, 1, text('Work'));
  set(20, 2, { effectiveValue: { boolValue: true } });
  set(21, 1, text('Total'));
  set(21, 2, num(125));
  set(25, 1, text('Spendable Money'));
  set(25, 2, num(125));
  return {
    spreadsheetId: 'synthetic',
    sheets: [
      {
        properties: { title: 'Networth Calculator', sheetId: 0, gridProperties: { columnCount: 4 } },
        data: [{ rowData: rows }],
      },
    ],
  };
}
test('actual dates override headings; formulas stay metadata; totals and checkbox excluded', () => {
  const result = normalizeNetworthSheet(fixture(), { fetchedAt: '2026-01-01T00:00:00Z' });
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].date, '2022-06-15');
  assert.equal(result.records[0].balance, 125);
  assert.equal(result.records[0].formula, '=100+25');
  assert.equal(result.records[0].sourceKey, 'sheet:0:R4C2');
  assert.equal(result.accounts.length, 2);
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(result, normalizeNetworthSheet(fixture(), { fetchedAt: result.fetchedAt }));
});
test('blank cells remain missing and explicit zero remains a snapshot', () => {
  const result = normalizeNetworthSheet(fixture());
  assert.equal(result.records[1].balance, 0);
  assert.equal(result.records.filter((r) => r.accountKey === 'sheet-row-5').length, 0);
});
test('missing date never becomes a fabricated monthly date', () => {
  const input = fixture();
  input.sheets[0].data[0].rowData[2].values[1] = {};
  const result = normalizeNetworthSheet(input);
  assert.equal(result.records.length, 1);
  assert.match(result.warnings[0], /without a recorded date/);
});
test('invalid workbook shape and impossible dates reject', () => {
  assert.throws(() => normalizeNetworthSheet({}), /Expected/);
  assert.throws(() => sheetsDate(NaN), /Invalid/);
});
test('rounds imported USD balances to two decimal places', () => {
  const input = fixture();
  input.sheets[0].data[0].rowData[3].values[1].effectiveValue.numberValue = 123.4567;
  const result = normalizeNetworthSheet(input);
  assert.equal(result.records[0].balance, 123.46);
  assert.equal('sourceValue' in result.records[0], false);
  assert.ok(result.warnings.some((w) => w.includes('rounded to two decimal places')));
});
