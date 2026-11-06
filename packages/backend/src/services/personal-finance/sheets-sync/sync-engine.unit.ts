import { describe, expect, it } from '@jest/globals';

import { preferredSnapshots } from '../calculations';
import type { FinanceCashFlow, FinanceSnapshot } from '../types';
import { cellAt, cellKey, contributionDate, dateSerial, type SheetGrid, type SheetSyncConfig } from './layout';
import {
  synchronizeSheet,
  type CellState,
  type OutboxOperation,
  type SyncConflict,
  type SyncRepository,
} from './sync-engine';
const config: SheetSyncConfig = {
  enabled: true,
  spreadsheetId: 'fixture',
  sheetId: 0,
  sheetName: 'History',
  mirrorSimplefin: false,
  mappings: [{ accountId: 'a', balanceRow: 4, principalRow: 51 }],
};
function fixture(initial: Record<string, unknown> = {}) {
  const grid: SheetGrid = { sheetId: 0, sheetName: 'History', rowCount: 70, columnCount: 8, cells: new Map() };
  grid.cells.set('3:2', { userEnteredValue: { numberValue: dateSerial('2026-11-01') } });
  for (const [key, value] of Object.entries(initial)) grid.cells.set(key, value as any);
  const snapshots: FinanceSnapshot[] = [];
  const flows: FinanceCashFlow[] = [];
  const states = new Map<string, CellState>();
  const conflicts: SyncConflict[] = [];
  const outbox: OutboxOperation[] = [];
  const writes: unknown[][] = [];
  let revision = 0,
    reads = 0;
  let beforePreflight: (() => void) | undefined;
  const repository: SyncRepository = {
    snapshots,
    flows,
    states,
    appendBalance: async (data) => {
      const row = { ...data, id: 'snapshot-' + ++revision, revision, createdAt: '2026-11-05T12:00:00Z' };
      const selected = preferredSnapshots([...snapshots, row]);
      snapshots.splice(0, snapshots.length, ...selected);
      return { id: row.id };
    },
    importContributions: async (records) => {
      let inserted = 0;
      for (const record of records) {
        if (flows.some((f) => f.sourceKey === record.sourceKey && f.sourceId === record.sourceId)) continue;
        flows.push({
          ...record,
          id: 'flow-' + ++revision,
          createdAt: '2026-11-05T12:00:00Z',
          toAccountId: null,
          opening: false,
          evidence: { ...record.evidence, originalNote: record.note },
        });
        inserted++;
      }
      return { inserted, corrected: 0, conflicts: [] };
    },
    saveState: async (key, state) => {
      states.set(key, state);
    },
    currentOriginIds: async () => new Set([...snapshots, ...flows].map((row) => row.id)),
    conflict: async (conflict) => {
      conflicts.push(conflict);
    },
    queue: async (operation) => {
      outbox.push(operation);
      return 'outbox-' + outbox.length;
    },
    complete: async () => {},
  };
  const transport = {
    read: async () => {
      reads++;
      if (reads === 2) beforePreflight?.();
      return structuredClone(grid);
    },
    write: async (_config: SheetSyncConfig, requests: unknown[]) => {
      writes.push(requests);
      for (const request of requests as any[]) {
        if (request.appendDimension) grid.columnCount += request.appendDimension.length;
        const update = request.updateCells;
        if (!update) continue;
        for (const [ri, row] of update.rows.entries())
          for (const [ci, cell] of row.values.entries()) {
            const key = cellKey(update.range.startRowIndex + ri + 1, update.range.startColumnIndex + ci + 1);
            grid.cells.set(key, { ...grid.cells.get(key), ...cell });
          }
      }
    },
  };
  const manual = async (date: string, balance: number) =>
    repository.appendBalance({
      accountId: 'a',
      date,
      balance,
      currencyCode: 'USD',
      source: 'manual',
      sourceId: 'manual',
      sourceKey: 'manual-' + revision,
      sourceLabel: 'Manual',
      formula: null,
      verified: true,
      description: '',
    });
  return {
    grid,
    snapshots,
    flows,
    states,
    conflicts,
    outbox,
    writes,
    manual,
    repository,
    transport,
    onPreflight: (fn: () => void) => {
      beforePreflight = fn;
    },
  };
}
describe('automatic Google Sheets reconciliation', () => {
  it('pulls a Sheet edit, pushes a manual edit, and repeats without loops or duplicate valuations', async () => {
    const f = fixture({ '4:2': { userEnteredValue: { numberValue: 100 } } });
    expect((await synchronizeSheet(config, f.transport, f.repository)).importedBalances).toBe(1);
    expect((await synchronizeSheet(config, f.transport, f.repository)).importedBalances).toBe(0);
    await f.manual('2026-11-01', 120);
    expect((await synchronizeSheet(config, f.transport, f.repository)).writtenBalances).toBe(1);
    expect(cellAt(f.grid, 4, 2).userEnteredValue?.numberValue).toBe(120);
    f.grid.cells.set('4:2', { ...cellAt(f.grid, 4, 2), userEnteredValue: { numberValue: 130 } });
    expect((await synchronizeSheet(config, f.transport, f.repository)).importedBalances).toBe(1);
    expect(f.snapshots[0]).toMatchObject({ balance: 130, source: 'google-sheets', isManualCorrection: true });
    const count = f.snapshots.length;
    expect(await synchronizeSheet(config, f.transport, f.repository)).toMatchObject({
      writtenBalances: 0,
      importedBalances: 0,
      conflicts: 0,
    });
    expect(f.snapshots).toHaveLength(count);
  });
  it('preserves conflicting edits and existing formulas instead of overwriting them', async () => {
    const f = fixture({ '4:2': { userEnteredValue: { numberValue: 100 } } });
    await synchronizeSheet(config, f.transport, f.repository);
    await f.manual('2026-11-01', 120);
    f.grid.cells.set('4:2', { userEnteredValue: { numberValue: 130 } });
    expect((await synchronizeSheet(config, f.transport, f.repository)).conflicts).toBe(1);
    expect(f.writes).toHaveLength(0);
    const formula = fixture({
      '4:2': { userEnteredValue: { formulaValue: '=50+50' }, effectiveValue: { numberValue: 100 } },
    });
    await synchronizeSheet(config, formula.transport, formula.repository);
    await formula.manual('2026-11-01', 120);
    expect((await synchronizeSheet(config, formula.transport, formula.repository)).conflicts).toBe(1);
    expect(cellAt(formula.grid, 4, 2).userEnteredValue?.formulaValue).toBe('=50+50');
  });
  it('extends a missing date without copying an old account valuation and retains timeline formulas', async () => {
    const f = fixture({ '20:2': { userEnteredValue: { formulaValue: '=SUM(B4:B19)' } } });
    await f.manual('2026-11-05', 0);
    expect((await synchronizeSheet(config, f.transport, f.repository)).writtenBalances).toBe(1);
    expect(cellAt(f.grid, 3, 3).userEnteredValue?.numberValue).toBe(dateSerial('2026-11-05'));
    expect(cellAt(f.grid, 4, 3).userEnteredValue?.numberValue).toBe(0);
    expect(cellAt(f.grid, 5, 3).userEnteredValue).toBeUndefined();
    expect(f.writes[0]).toContainEqual(
      expect.objectContaining({ copyPaste: expect.objectContaining({ pasteType: 'PASTE_FORMULA' }) }),
    );
  });
  it('blocks a remote edit made while a manual write is being prepared', async () => {
    const f = fixture();
    await f.manual('2026-11-05', 120);
    f.onPreflight(() => f.grid.cells.set('4:3', { userEnteredValue: { numberValue: 999 } }));
    expect((await synchronizeSheet(config, f.transport, f.repository)).conflicts).toBe(1);
    expect(cellAt(f.grid, 4, 3).userEnteredValue?.numberValue).toBe(999);
    expect(f.outbox).toHaveLength(1);
  });
  it('writes a contribution with a native date note once, then recognizes its trace marker', async () => {
    const f = fixture();
    f.flows.push({
      id: '11111111-1111-4111-8111-111111111111',
      accountId: 'a',
      date: '2026-11-05',
      amount: 200,
      type: 'contribution',
      toAccountId: null,
      opening: false,
      description: 'Confirmed funding',
      createdAt: '',
      source: 'bank-transfer',
      verified: true,
    });
    expect((await synchronizeSheet(config, f.transport, f.repository)).writtenContributions).toBe(1);
    expect(cellAt(f.grid, 51, 5).note).toContain('Date: 2026-11-05');
    expect(contributionDate(cellAt(f.grid, 51, 5).note!)).toBe('2026-11-05');
    expect(cellAt(f.grid, 3, 5).userEnteredValue).toBeUndefined();
    expect(await synchronizeSheet(config, f.transport, f.repository)).toMatchObject({
      writtenContributions: 0,
      importedContributions: 0,
    });
    expect(f.flows).toHaveLength(1);
  });
  it('keeps yearless or ambiguous old notes unresolved while accepting the explicit contribution date over audit timestamps', () => {
    expect(contributionDate('Dec 5th')).toBeNull();
    expect(contributionDate('2026-06-11\nReconciled 2026-11-05; source file 2026-11-05.csv')).toBe('2026-06-11');
    expect(contributionDate('Paid 2026-06-11 or 2026-06-12')).toBeNull();
  });
  it('corrects an existing Sheet contribution in place while preserving the prior note for audit', async () => {
    const oldNote = '2026-11-01\nVerified manual contribution';
    const f = fixture({ '51:5': { userEnteredValue: { numberValue: 100 }, note: oldNote } });
    f.flows.push({
      id: '22222222-2222-4222-8222-222222222222',
      accountId: 'a',
      date: '2026-11-01',
      amount: 120,
      type: 'contribution',
      toAccountId: null,
      opening: false,
      description: 'Correction',
      createdAt: '',
      source: 'manual',
      sourceId: 'google-sheets:fixture:0:principal',
      sourceKey: 'sheet:0:R51C5',
      verified: true,
      evidence: {
        manualCorrectionOf: '11111111-1111-4111-8111-111111111111',
        previousAmountCents: 10000,
        previousOriginalNote: oldNote,
      },
    });
    const result = await synchronizeSheet(config, f.transport, f.repository);
    expect(result.writtenContributions).toBe(1);
    expect(cellAt(f.grid, 51, 5).userEnteredValue?.numberValue).toBe(120);
    expect(cellAt(f.grid, 51, 6).userEnteredValue).toBeUndefined();
    expect(cellAt(f.grid, 51, 5).note).toContain(oldNote);
  });
});
