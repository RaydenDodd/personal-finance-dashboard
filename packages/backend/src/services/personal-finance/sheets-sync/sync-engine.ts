import type { FinanceCashFlow, FinanceSnapshot } from '../types';
import type { SheetsTransport } from './google-client';
import {
  blankCell,
  cellAt,
  cellCents,
  cellFingerprint,
  cellKey,
  contributionDate,
  contributionMarker,
  dateColumns,
  dateSerial,
  balanceDecision,
  fingerprint,
  type SheetCell,
  type SheetGrid,
  type SheetSyncConfig,
  writeCellRequest,
} from './layout';

export interface CellState {
  sheetFingerprint: string;
  snapshotId?: string;
  cents: number | null;
  row: number;
  column: number;
}
export interface SyncConflict {
  key: string;
  accountId: string;
  date: string;
  kind: 'balance' | 'principal';
  reason: string;
  sheetValue: unknown;
  dashboardValue: unknown;
  sheetFingerprint: string;
  localFingerprint: string;
}
export interface OutboxOperation {
  key: string;
  kind: 'balance' | 'principal';
  accountId: string;
  date: string;
  originId: string;
  row: number;
  column: number;
  cents: number;
  note: string;
  before: SheetCell;
  expectedHash: string;
  newDate?: boolean;
}
export interface SyncRepository {
  snapshots: FinanceSnapshot[];
  flows: FinanceCashFlow[];
  states: Map<string, CellState>;
  appendBalance(data: Omit<FinanceSnapshot, 'id' | 'createdAt'>): Promise<{ id: string }>;
  importContributions(records: any[]): Promise<{ inserted: number; corrected: number; conflicts: unknown[] }>;
  saveState(key: string, state: CellState): Promise<void>;
  currentOriginIds(): Promise<Set<string>>;
  conflict(conflict: SyncConflict): Promise<void>;
  queue(operation: OutboxOperation): Promise<string>;
  complete(id: string, status: 'applied' | 'blocked'): Promise<void>;
}
export interface SyncResult {
  importedBalances: number;
  importedContributions: number;
  writtenBalances: number;
  writtenContributions: number;
  conflicts: number;
  issues: Array<{ accountId: string; reason: string; cell?: string }>;
}
export async function synchronizeSheet(
  config: SheetSyncConfig,
  transport: SheetsTransport,
  repo: SyncRepository,
): Promise<SyncResult> {
  const result: SyncResult = {
    importedBalances: 0,
    importedContributions: 0,
    writtenBalances: 0,
    writtenContributions: 0,
    conflicts: 0,
    issues: [],
  };
  const grid = await transport.read(config);
  if (grid.sheetName !== config.sheetName) throw Error('sheet_mapping_changed');
  const columns = dateColumns(grid);
  const originalDates = new Set(columns.keys());
  const operations: OutboxOperation[] = [];
  const sourceId = `google-sheets:${config.spreadsheetId}:${config.sheetId}`;
  const latest = new Map<string, FinanceSnapshot>();
  // Input is the reporting service's effective revision set, ordered by source authority.
  for (const snapshot of repo.snapshots) {
    if (snapshot.source === 'simplefin' && !config.mirrorSimplefin) continue;
    const key = `${snapshot.accountId}:${snapshot.date}`;
    latest.set(key, snapshot);
  }
  let nextColumn = 1;
  for (const [coordinate, cell] of grid.cells) {
    const [row, column] = coordinate.split(':').map(Number);
    if (row! <= 20 && !blankCell(cell)) nextColumn = Math.max(nextColumn, column!);
  }
  nextColumn++;
  const reserveDate = (date: string) => {
    if (columns.has(date)) return { column: columns.get(date)!, newDate: false };
    const column = nextColumn++;
    columns.set(date, column);
    return { column, newDate: true };
  };
  const conflict = async (data: SyncConflict) => {
    await repo.conflict(data);
    result.conflicts++;
  };
  for (const mapping of config.mappings) {
    const dates = [
      ...new Set([
        ...columns.keys(),
        ...repo.snapshots.filter((s) => s.accountId === mapping.accountId && s.source === 'manual').map((s) => s.date),
        ...(config.mirrorSimplefin
          ? repo.snapshots
              .filter((s) => s.accountId === mapping.accountId && s.source === 'simplefin' && s.verified)
              .map((s) => s.date)
          : []),
      ]),
    ].sort();
    for (const date of dates) {
      const key = `balance:${mapping.accountId}:${date}`;
      const local = latest.get(`${mapping.accountId}:${date}`);
      const state = repo.states.get(key);
      const column = columns.get(date);
      const remote = column ? cellAt(grid, mapping.balanceRow, column) : {};
      const remoteCents = cellCents(remote);
      const localCents = local ? Math.round(local.balance * 100) : null;
      if (remoteCents === null && localCents === null) continue;
      const remoteHash = cellFingerprint(remote);
      const decision = balanceDecision({
        remoteCents,
        localCents,
        localSource: local?.source,
        remoteChanged: Boolean(state && state.sheetFingerprint !== remoteHash),
        localChanged: Boolean(state && state.snapshotId !== local?.id),
        hasBaseline: Boolean(state),
        isFormula: Boolean(remote.userEnteredValue?.formulaValue),
      });
      if (decision === 'conflict') {
        await conflict({
          key,
          accountId: mapping.accountId,
          date,
          kind: 'balance',
          reason: remote.userEnteredValue?.formulaValue ? 'sheet_formula_protected' : 'independent_balance_edits',
          sheetValue: remoteCents === null ? null : remoteCents / 100,
          dashboardValue: localCents === null ? null : localCents / 100,
          sheetFingerprint: remoteHash,
          localFingerprint: local?.id ?? 'none',
        });
        continue;
      }
      if (decision === 'pull') {
        const inserted = await repo.appendBalance({
          accountId: mapping.accountId,
          date,
          balance: remoteCents! / 100,
          currencyCode: 'USD',
          source: 'google-sheets',
          sourceId,
          sourceKey: `sheet:${config.sheetId}:R${mapping.balanceRow}C${column}`,
          sourceLabel: `Google Sheets / ${config.sheetName}`,
          formula: remote.userEnteredValue?.formulaValue ?? null,
          verified: true,
          isManualCorrection: Boolean(state && state.sheetFingerprint !== remoteHash),
          description: 'Automatic Sheet revision. Original values are retained.',
        });
        result.importedBalances++;
        await repo.saveState(key, {
          sheetFingerprint: remoteHash,
          snapshotId: inserted.id,
          cents: remoteCents,
          row: mapping.balanceRow,
          column: column!,
        });
        continue;
      }
      if (decision === 'push') {
        if (
          !local ||
          !local.verified ||
          !['manual', ...(config.mirrorSimplefin ? ['simplefin'] : [])].includes(local.source)
        )
          continue;
        const slot = reserveDate(date);
        operations.push({
          key,
          kind: 'balance',
          accountId: mapping.accountId,
          date,
          originId: local.id,
          row: mapping.balanceRow,
          column: slot.column,
          cents: localCents!,
          before: remote,
          expectedHash: remoteHash,
          newDate: slot.newDate,
          note: [
            remote.note,
            `MoneyMatter valuation: ${local.id}`,
            `Effective date: ${date}`,
            `Source: ${local.source}`,
          ]
            .filter(Boolean)
            .join('\n'),
        });
        continue;
      }
      if (column)
        await repo.saveState(key, {
          sheetFingerprint: remoteHash,
          snapshotId: local?.id,
          cents: remoteCents,
          row: mapping.balanceRow,
          column,
        });
    }
  }
  const knownFlows = new Map(repo.flows.map((flow) => [flow.id, flow]));
  const imported: any[] = [];
  for (const mapping of config.mappings.filter((m) => m.principalRow))
    for (let column = 5; column <= grid.columnCount; column++) {
      const remote = cellAt(grid, mapping.principalRow!, column);
      const amount = cellCents(remote);
      if (amount === null) continue;
      const key = `principal-cell:${mapping.accountId}:${mapping.principalRow}:${column}`;
      const hash = cellFingerprint(remote);
      const state = repo.states.get(key);
      if (state?.sheetFingerprint === hash) continue;
      const existingSource = repo.flows.find(
        (flow) =>
          flow.sourceId === sourceId + ':principal' &&
          flow.sourceKey === `sheet:${config.sheetId}:R${mapping.principalRow}C${column}`,
      );
      if (
        existingSource &&
        Math.round(existingSource.amount * 100) === (existingSource.type === 'withdrawal' ? -amount : amount) &&
        existingSource.evidence?.originalNote === (remote.note ?? '')
      ) {
        await repo.saveState(key, {
          sheetFingerprint: hash,
          snapshotId: existingSource.id,
          cents: amount,
          row: mapping.principalRow!,
          column,
        });
        continue;
      }
      const marker = contributionMarker(remote.note ?? '');
      const date = contributionDate(remote.note ?? '');
      if (marker && knownFlows.has(marker)) {
        const flow = knownFlows.get(marker)!;
        const expected =
          (flow.accountId === mapping.accountId && ['withdrawal', 'transfer'].includes(flow.type) ? -1 : 1) *
          Math.round(flow.amount * 100);
        if (amount !== expected && date)
          await conflict({
            key,
            accountId: mapping.accountId,
            date,
            kind: 'principal',
            reason: 'verified_contribution_changed',
            sheetValue: amount / 100,
            dashboardValue: expected / 100,
            sheetFingerprint: hash,
            localFingerprint: flow.id,
          });
        else
          await repo.saveState(key, {
            sheetFingerprint: hash,
            snapshotId: flow.id,
            cents: amount,
            row: mapping.principalRow!,
            column,
          });
        continue;
      }
      if (marker || !date) {
        if (result.issues.length < 100)
          result.issues.push({
            accountId: mapping.accountId,
            reason: marker ? 'unknown_cash_flow_reference' : 'contribution_date_unverified',
            cell: `R${mapping.principalRow}C${column}`,
          });
        continue;
      }
      imported.push({
        accountId: mapping.accountId,
        date,
        amount: Math.abs(amount) / 100,
        type: amount < 0 ? 'withdrawal' : 'contribution',
        source: 'google-sheets',
        sourceId: sourceId + ':principal',
        sourceKey: `sheet:${config.sheetId}:R${mapping.principalRow}C${column}`,
        verified: true,
        contributionKind: 'unspecified',
        description: 'Google Sheets contribution with explicit dated note',
        note: remote.note ?? '',
        evidence: { sheetRow: mapping.principalRow, sheetColumn: column },
      });
    }
  if (imported.length) {
    const importedResult = await repo.importContributions(imported);
    result.importedContributions = importedResult.inserted + importedResult.corrected;
    for (const issue of importedResult.conflicts)
      if (result.issues.length < 100)
        result.issues.push({ accountId: (issue as any).accountId ?? '', reason: 'contribution_requires_review' });
    // Only unchanged/accepted imports acquire a baseline. Conflicts remain visible on retry.
    if (!importedResult.conflicts.length)
      for (const record of imported) {
        const row = record.evidence.sheetRow,
          column = record.evidence.sheetColumn;
        await repo.saveState(`principal-cell:${record.accountId}:${row}:${column}`, {
          sheetFingerprint: cellFingerprint(cellAt(grid, row, column)),
          cents: record.type === 'withdrawal' ? -Math.round(record.amount * 100) : Math.round(record.amount * 100),
          row,
          column,
        });
      }
  }
  const occupied = new Set<string>();
  const contributionLegs = repo.flows.flatMap((flow) => {
    if (
      flow.opening ||
      flow.verified === false ||
      flow.source === 'google-sheets' ||
      !['contribution', 'withdrawal', 'transfer', 'adjustment'].includes(flow.type)
    )
      return [];
    return [
      { flow, accountId: flow.accountId, sign: ['withdrawal', 'transfer'].includes(flow.type) ? -1 : 1 },
      ...(flow.type === 'transfer' && flow.toAccountId ? [{ flow, accountId: flow.toAccountId, sign: 1 }] : []),
    ];
  });
  for (const { flow, accountId, sign } of contributionLegs) {
    const mapping = config.mappings.find((m) => m.accountId === accountId && m.principalRow);
    if (!mapping) continue;
    const key = `principal-flow:${flow.id}:${accountId}`;
    if (repo.states.has(key)) continue;
    const predecessor = typeof flow.evidence?.manualCorrectionOf === 'string' ? flow.evidence.manualCorrectionOf : null;
    // A retry locates the trace marker, including a request whose response was lost.
    let existingColumn: number | undefined;
    for (let column = 5; column <= grid.columnCount; column++) {
      const marker = contributionMarker(cellAt(grid, mapping.principalRow!, column).note ?? '');
      if (marker === flow.id || (predecessor && marker === predecessor)) {
        existingColumn = column;
        break;
      }
    }
    const sourceCoordinate =
      flow.sourceId === sourceId + ':principal' ? /^sheet:\d+:R(\d+)C(\d+)$/.exec(flow.sourceKey ?? '') : null;
    if (!existingColumn && predecessor && sourceCoordinate && Number(sourceCoordinate[1]) === mapping.principalRow)
      existingColumn = Number(sourceCoordinate[2]);
    const value = sign * Math.round(flow.amount * 100);
    if (existingColumn && predecessor) {
      const remote = cellAt(grid, mapping.principalRow!, existingColumn);
      const previous = flow.evidence?.previousAmountCents;
      const oldNote = flow.evidence?.previousOriginalNote;
      const previousState =
        repo.states.get(`principal-flow:${predecessor}:${accountId}`) ??
        repo.states.get(`principal-cell:${accountId}:${mapping.principalRow}:${existingColumn}`);
      const unchanged = previousState
        ? previousState.sheetFingerprint === cellFingerprint(remote)
        : typeof previous === 'number' &&
          cellCents(remote) === sign * previous &&
          (typeof oldNote !== 'string' || oldNote === (remote.note ?? ''));
      if (unchanged && !remote.userEnteredValue?.formulaValue) {
        operations.push({
          key,
          kind: 'principal',
          accountId,
          date: flow.date,
          originId: flow.id,
          row: mapping.principalRow!,
          column: existingColumn,
          cents: value,
          before: remote,
          expectedHash: cellFingerprint(remote),
          note: `Date: ${flow.date}\nMoneyMatter cash-flow: ${flow.id}\nPrevious note:\n${remote.note ?? ''}`,
        });
        continue;
      }
    }
    if (existingColumn) {
      const remote = cellAt(grid, mapping.principalRow!, existingColumn);
      if (cellCents(remote) === value) {
        await repo.saveState(key, {
          sheetFingerprint: cellFingerprint(remote),
          snapshotId: flow.id,
          cents: value,
          row: mapping.principalRow!,
          column: existingColumn,
        });
        continue;
      }
      await conflict({
        key,
        accountId,
        date: flow.date,
        kind: 'principal',
        reason: 'existing_contribution_marker_differs',
        sheetValue: (cellCents(remote) ?? 0) / 100,
        dashboardValue: value / 100,
        sheetFingerprint: cellFingerprint(remote),
        localFingerprint: flow.id,
      });
      continue;
    }
    let column = 5;
    while (
      column <= grid.columnCount &&
      (!blankCell(cellAt(grid, mapping.principalRow!, column)) || occupied.has(cellKey(mapping.principalRow!, column)))
    )
      column++;
    occupied.add(cellKey(mapping.principalRow!, column));
    const before = cellAt(grid, mapping.principalRow!, column);
    operations.push({
      key,
      kind: 'principal',
      accountId,
      date: flow.date,
      originId: flow.id,
      row: mapping.principalRow!,
      column,
      cents: value,
      before,
      expectedHash: cellFingerprint(before),
      note: `Date: ${flow.date}\nMoneyMatter cash-flow: ${flow.id}\nAccount: ${accountId}${flow.transactionId ? '\nSource transaction: ' + flow.transactionId : ''}`,
    });
  }
  if (!operations.length) return result;
  // Persist the exact prior cells before external writes. Re-read immediately before
  // the atomic Google batch, protecting edits made while the poll was preparing.
  const queued = await Promise.all(
    operations.map(async (operation) => ({ operation, id: await repo.queue(operation) })),
  );
  const preflight = await transport.read(config);
  const currentOriginIds = await repo.currentOriginIds();
  const safe: typeof queued = [];
  for (const item of queued) {
    const current = cellAt(preflight, item.operation.row, item.operation.column);
    if (cellFingerprint(current) !== item.operation.expectedHash || !currentOriginIds.has(item.operation.originId)) {
      await repo.complete(item.id, 'blocked');
      await conflict({
        key: item.operation.key,
        accountId: item.operation.accountId,
        date: item.operation.date,
        kind: item.operation.kind,
        reason: currentOriginIds.has(item.operation.originId)
          ? 'sheet_changed_before_write'
          : 'dashboard_changed_before_write',
        sheetValue: cellCents(current) === null ? null : cellCents(current)! / 100,
        dashboardValue: item.operation.cents / 100,
        sheetFingerprint: cellFingerprint(current),
        localFingerprint: item.operation.originId,
      });
    } else safe.push(item);
  }
  const requests: unknown[] = [];
  const maxColumn = Math.max(preflight.columnCount, ...safe.map((item) => item.operation.column));
  if (maxColumn > preflight.columnCount)
    requests.push({
      appendDimension: { sheetId: config.sheetId, dimension: 'COLUMNS', length: maxColumn - preflight.columnCount },
    });
  const datesWritten = new Set<string>();
  for (const { operation } of safe) {
    if (operation.kind === 'balance' && !originalDates.has(operation.date) && !datesWritten.has(operation.date)) {
      // A second header check prevents overwriting another newly appended date.
      if (!blankCell(cellAt(preflight, 3, operation.column))) throw Error('date_column_changed');
      const exemplar = [...dateColumns(preflight).values()].at(-1);
      if (exemplar) {
        requests.push({
          copyPaste: {
            source: {
              sheetId: config.sheetId,
              startRowIndex: 0,
              endRowIndex: 47,
              startColumnIndex: exemplar - 1,
              endColumnIndex: exemplar,
            },
            destination: {
              sheetId: config.sheetId,
              startRowIndex: 0,
              endRowIndex: 47,
              startColumnIndex: operation.column - 1,
              endColumnIndex: operation.column,
            },
            pasteType: 'PASTE_FORMAT',
          },
        });
        for (let row = 20; row <= 47; row++)
          if (cellAt(preflight, row, exemplar).userEnteredValue?.formulaValue)
            requests.push({
              copyPaste: {
                source: {
                  sheetId: config.sheetId,
                  startRowIndex: row - 1,
                  endRowIndex: row,
                  startColumnIndex: exemplar - 1,
                  endColumnIndex: exemplar,
                },
                destination: {
                  sheetId: config.sheetId,
                  startRowIndex: row - 1,
                  endRowIndex: row,
                  startColumnIndex: operation.column - 1,
                  endColumnIndex: operation.column,
                },
                pasteType: 'PASTE_FORMULA',
              },
            });
      }
      requests.push(writeCellRequest(preflight, 1, operation.column, Number(operation.date.slice(0, 4))));
      requests.push({
        updateCells: {
          range: {
            sheetId: config.sheetId,
            startRowIndex: 1,
            endRowIndex: 2,
            startColumnIndex: operation.column - 1,
            endColumnIndex: operation.column,
          },
          rows: [
            {
              values: [
                {
                  userEnteredValue: {
                    stringValue: new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
                      new Date(operation.date + 'T12:00:00Z'),
                    ),
                  },
                },
              ],
            },
          ],
          fields: 'userEnteredValue',
        },
      });
      requests.push(writeCellRequest(preflight, 3, operation.column, dateSerial(operation.date)));
      requests.push({
        repeatCell: {
          range: {
            sheetId: config.sheetId,
            startRowIndex: 2,
            endRowIndex: 3,
            startColumnIndex: operation.column - 1,
            endColumnIndex: operation.column,
          },
          cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      });
      datesWritten.add(operation.date);
    }
    requests.push(writeCellRequest(preflight, operation.row, operation.column, operation.cents / 100, operation.note));
  }
  await transport.write(config, requests);
  const after = await transport.read(config);
  for (const { operation, id } of safe) {
    const written = cellAt(after, operation.row, operation.column);
    if (cellCents(written) !== operation.cents || written.note !== operation.note) {
      await repo.complete(id, 'blocked');
      await conflict({
        key: operation.key,
        accountId: operation.accountId,
        date: operation.date,
        kind: operation.kind,
        reason: 'write_readback_changed',
        sheetValue: cellCents(written) === null ? null : cellCents(written)! / 100,
        dashboardValue: operation.cents / 100,
        sheetFingerprint: cellFingerprint(written),
        localFingerprint: operation.originId,
      });
      continue;
    }
    await repo.complete(id, 'applied');
    await repo.saveState(operation.key, {
      sheetFingerprint: cellFingerprint(written),
      snapshotId: operation.originId,
      cents: operation.cents,
      row: operation.row,
      column: operation.column,
    });
    if (operation.kind === 'balance') result.writtenBalances++;
    else result.writtenContributions++;
  }
  return result;
}
