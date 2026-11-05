import { describe, expect, it } from 'vitest';

import { isRecordedDate, mapHistoryRecords, parseHistoryFile } from './history-import';

describe('historical balance file import', () => {
  it('preserves actual recorded days, zero balances, formulas and historical names while skipping blanks', () => {
    const parsed = parseHistoryFile(
      JSON.stringify({
        sourceId: 'synthetic-sheet',
        records: [
          { accountName: 'Legacy savings', date: '2022-06-15', balance: 125, formula: '=100+25', verified: true },
          { accountName: 'Legacy savings', date: '2022-07-21', balance: '' },
          { accountName: 'Legacy savings', date: '2022-08-22', balance: 0 },
        ],
      }),
      'history.json',
    );
    expect(parsed.skippedBlank).toBe(1);
    expect(parsed.records.map((r) => r.date)).toEqual(['2022-06-15', '2022-08-22']);
    const mapped = mapHistoryRecords(parsed.sourceId, parsed.records, { 'Legacy savings': 'current-savings' });
    expect(mapped.records[0]).toMatchObject({
      accountId: 'current-savings',
      balance: 125,
      sourceLabel: 'Legacy savings',
      formula: '=100+25',
      verified: true,
    });
    expect(mapped.records[1]!.balance).toBe(0);
    expect(mapped.records.map((r) => r.sourceKey)).toEqual(
      mapHistoryRecords(parsed.sourceId, parsed.records, { 'Legacy savings': 'current-savings' }).records.map(
        (r) => r.sourceKey,
      ),
    );
  });

  it('reads quoted CSV currency values and preserves explicit negative liabilities', () => {
    const parsed = parseHistoryFile(
      'account,date,balance,currencyCode\nCard,2026-01-17,"($1,234.56)",USD\nCash,2026-01-17,0,USD\n',
      'history.csv',
    );
    expect(parsed.records.map((r) => r.balance)).toEqual([-1234.56, 0]);
  });

  it('requires explicit mapping and lets a user skip a combined historical row', () => {
    const parsed = parseHistoryFile(
      '[{"accountName":"Combined legacy","date":"2022-06-15","balance":100},{"accountName":"Checking","date":"2022-06-15","balance":20}]',
      'history.json',
    );
    expect(() => mapHistoryRecords(parsed.sourceId, parsed.records, {})).toThrow('Map the historical account');
    expect(
      mapHistoryRecords(parsed.sourceId, parsed.records, { 'Combined legacy': '__skip__', Checking: 'checking-id' })
        .records,
    ).toHaveLength(1);
  });

  it('keeps the original source identity when a Sheet export is renamed', () => {
    const csv =
      'accountName,date,balance,sourceId,sourceKey,verified\nSavings,2026-11-01,10.25,sheet:synthetic,B5,true\n';
    const parsed = parseHistoryFile(csv, 'renamed-copy.csv');
    expect(parsed.sourceId).toBe('sheet:synthetic');
    expect(parsed.records[0]).toMatchObject({ sourceKey: 'B5', verified: true, balance: 10.25 });
    expect(() => parseHistoryFile(csv + 'Cash,2026-11-01,1.00,sheet:other,B6,true\n', 'mixed.csv')).toThrow(
      'multiple source identities',
    );
  });

  it('rejects impossible or inferred dates and invalid financial values', () => {
    expect(isRecordedDate('2026-02-30')).toBe(false);
    expect(isRecordedDate('2024-02-29')).toBe(true);
    expect(isRecordedDate('2026-02')).toBe(false);
    expect(() => parseHistoryFile('account,date,balance\nSavings,2026-02-30,100', 'history.csv')).toThrow(
      'actual recorded date',
    );
    expect(() => parseHistoryFile('account,date,balance\nSavings,2026-02-20,NaN', 'history.csv')).toThrow(
      'balance must be a number',
    );
  });
});
