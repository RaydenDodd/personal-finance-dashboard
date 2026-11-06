import { ValidationError } from '@js/errors';
import { connection } from '@models/index';
import { decryptCredentials, encryptCredentials } from '@services/bank-data-providers/utils/credential-encryption';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { QueryTypes, type Transaction } from 'sequelize';

import { addFinanceSnapshot, appendFinanceSourceSnapshot, getFinanceAccounts, getFinanceDashboard } from '../index';
import { importPrincipalRecords } from '../principal';
import {
  environmentCredentials,
  exchangeAuthorizationCode,
  googleSheetsTransport,
  oauthSettings,
  type SheetsCredentials,
  validateCredentials,
} from './google-client';
import {
  assertMappedRows,
  cellAt,
  cellCents,
  cellFingerprint,
  fingerprint,
  type SheetSyncConfig,
  writeCellRequest,
} from './layout';
import { type CellState, type OutboxOperation, type SyncConflict, synchronizeSheet } from './sync-engine';

type SyncRow = {
  userId: number;
  config: SheetSyncConfig;
  credentials: string | null;
  oauthState: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  lastResult: any;
};
const query = <T>(sql: string, replacements: Record<string, unknown> = {}, transaction?: Transaction): Promise<T[]> =>
  connection.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction, logging: false });
const execute = (sql: string, replacements: Record<string, unknown> = {}, transaction?: Transaction) =>
  connection.sequelize.query(sql, { replacements, transaction, logging: false });
function fail(message: string): never {
  throw new ValidationError({ message });
}
const defaultConfig: SheetSyncConfig = {
  enabled: false,
  spreadsheetId: '',
  sheetName: 'Networth Calculator',
  sheetId: 0,
  mirrorSimplefin: false,
  mappings: [],
};
const settings = async (userId: number) =>
  (await query<SyncRow>('SELECT * FROM "PersonalFinanceSheetSync" WHERE "userId"=:userId', { userId }))[0];
async function credentials(row?: SyncRow): Promise<SheetsCredentials | null> {
  return row?.credentials
    ? validateCredentials(decryptCredentials(row.credentials) as unknown as SheetsCredentials)
    : environmentCredentials();
}
export async function getSheetSyncStatus(userId: number) {
  const row = await settings(userId);
  let auth: SheetsCredentials | null = null;
  let credentialsError: string | undefined;
  try {
    auth = await credentials(row);
  } catch {
    credentialsError = 'credential_file_unavailable';
  }
  const [pending, conflicts] = await Promise.all([
    query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM "PersonalFinanceSheetOutbox" WHERE "userId"=:userId AND status=\'pending\'',
      { userId },
    ),
    query(
      'SELECT id,"accountId",date::text,kind,reason,"sheetValue","dashboardValue",status,"createdAt" FROM "PersonalFinanceSheetConflicts" WHERE "userId"=:userId AND status=\'open\' ORDER BY "createdAt"',
      { userId },
    ),
  ]);
  return {
    config: row?.config ?? defaultConfig,
    credentialsConfigured: Boolean(auth),
    authKind: auth?.kind ?? null,
    serviceAccountEmail: auth?.kind === 'service-account' ? auth.clientEmail : null,
    oauthConfigured: oauthSettings().configured,
    lastAttemptAt: row?.lastAttemptAt ?? null,
    lastSuccessAt: row?.lastSuccessAt ?? null,
    lastErrorCode:
      credentialsError ?? row?.lastErrorCode ?? (row?.config.enabled && !auth ? 'credentials_missing' : null),
    pendingWrites: pending[0]?.count ?? 0,
    conflicts,
    issues: row?.lastResult?.issues ?? [],
    pollIntervalMinutes: 5,
  };
}
export async function configureSheetSync(userId: number, config: SheetSyncConfig) {
  const accounts = await getFinanceAccounts(userId);
  const ids = config.mappings.map((m) => m.accountId);
  const rows = config.mappings.map((m) => m.balanceRow);
  const principalRows = config.mappings.flatMap((m) => (m.principalRow ? [m.principalRow] : []));
  if (
    new Set(ids).size !== ids.length ||
    new Set(rows).size !== rows.length ||
    new Set(principalRows).size !== principalRows.length ||
    ids.some((id) => !accounts.some((a) => a.id === id && a.currencyCode === 'USD'))
  )
    fail('Every Sheet mapping must use a distinct owned USD account and row.');
  const prior = await settings(userId);
  if (config.acceptedLegacyPrincipalCells === undefined && prior?.config.acceptedLegacyPrincipalCells)
    config = { ...config, acceptedLegacyPrincipalCells: prior.config.acceptedLegacyPrincipalCells };
  if (
    prior &&
    fingerprint({
      ...prior.config,
      enabled: false,
      mirrorSimplefin: false,
      acceptedLegacyPrincipalCells: undefined,
    }) !== fingerprint({ ...config, enabled: false, mirrorSimplefin: false, acceptedLegacyPrincipalCells: undefined })
  ) {
    // A deliberate mapping change starts a new comparison baseline; old snapshots
    // and outbox records are preserved. No previous cell is ever reassigned by guess.
    await execute('DELETE FROM "PersonalFinanceSheetCells" WHERE "userId"=:userId', { userId });
    await execute(
      'UPDATE "PersonalFinanceSheetOutbox" SET status=\'blocked\',"updatedAt"=NOW() WHERE "userId"=:userId AND status=\'pending\'',
      { userId },
    );
  }
  await execute(
    'INSERT INTO "PersonalFinanceSheetSync" ("userId",config) VALUES (:userId,CAST(:config AS jsonb)) ON CONFLICT ("userId") DO UPDATE SET config=EXCLUDED.config,"updatedAt"=NOW()',
    { userId, config: JSON.stringify(config) },
  );
  return getSheetSyncStatus(userId);
}
export async function storeSheetCredentials(userId: number, input: SheetsCredentials) {
  let auth: SheetsCredentials;
  try {
    auth = validateCredentials(input);
  } catch {
    fail('The Google credential file could not be validated.');
  }
  const row = await settings(userId);
  await execute(
    'INSERT INTO "PersonalFinanceSheetSync" ("userId",config,credentials) VALUES (:userId,CAST(:config AS jsonb),:credentials) ON CONFLICT ("userId") DO UPDATE SET credentials=EXCLUDED.credentials,"lastErrorCode"=NULL,"updatedAt"=NOW()',
    {
      userId,
      config: JSON.stringify(row?.config ?? defaultConfig),
      credentials: encryptCredentials(auth as unknown as Record<string, unknown>),
    },
  );
  return getSheetSyncStatus(userId);
}
export async function startSheetsOAuth(userId: number) {
  const oauth = oauthSettings();
  if (!oauth.configured) fail('Configure a Google OAuth client and registered Sheets redirect URI first.');
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const expires = Date.now() + 15 * 60000;
  const row = await settings(userId);
  await execute(
    'INSERT INTO "PersonalFinanceSheetSync" ("userId",config,"oauthState") VALUES (:userId,CAST(:config AS jsonb),:state) ON CONFLICT ("userId") DO UPDATE SET "oauthState"=EXCLUDED."oauthState"',
    {
      userId,
      config: JSON.stringify(row?.config ?? defaultConfig),
      state: encryptCredentials({ state, verifier, expires }),
    },
  );
  const params = new URLSearchParams({
    client_id: oauth.clientId,
    redirect_uri: oauth.redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  return { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString() };
}
export async function completeSheetsOAuth(userId: number, state: string, code: string) {
  const row = await settings(userId);
  if (!row?.oauthState) fail('Google authorization is no longer pending.');
  const pending = decryptCredentials(row.oauthState);
  if (pending.state !== state || Number(pending.expires) < Date.now())
    fail('Google authorization expired; connect again.');
  await execute('UPDATE "PersonalFinanceSheetSync" SET "oauthState"=NULL WHERE "userId"=:userId', { userId });
  await storeSheetCredentials(userId, await exchangeAuthorizationCode(code, String(pending.verifier)));
  return { connected: true };
}
async function saveState(userId: number, key: string, state: CellState) {
  await execute(
    'INSERT INTO "PersonalFinanceSheetCells" ("userId",key,state) VALUES (:userId,:key,CAST(:state AS jsonb)) ON CONFLICT ("userId",key) DO UPDATE SET state=EXCLUDED.state,"updatedAt"=NOW()',
    { userId, key, state: JSON.stringify(state) },
  );
  await execute(
    "UPDATE \"PersonalFinanceSheetOutbox\" SET status=CASE WHEN payload->>'originId'=:originId THEN 'applied' ELSE 'blocked' END,\"updatedAt\"=NOW() WHERE \"userId\"=:userId AND key=:key AND status='pending'",
    { userId, key, originId: state.snapshotId ?? '' },
  );
  await execute(
    'UPDATE "PersonalFinanceSheetConflicts" SET status=\'converged\',"resolvedAt"=NOW() WHERE "userId"=:userId AND key=:key AND status=\'open\'',
    { userId, key },
  );
}
async function conflict(userId: number, data: SyncConflict) {
  return connection.sequelize.transaction(async (transaction: Transaction) => {
    const previous = (
      await query<SyncConflict & { id: string }>(
        'SELECT id,key,"accountId",date::text,kind,reason,"sheetValue","dashboardValue","sheetFingerprint","localFingerprint" FROM "PersonalFinanceSheetConflicts" WHERE "userId"=:userId AND key=:key AND status=\'open\' FOR UPDATE',
        { userId, key: data.key },
        transaction,
      )
    )[0];
    if (previous) {
      const { id: previousId, ...before } = previous;
      const content = (value: SyncConflict) =>
        fingerprint([
          value.key,
          value.accountId,
          value.date,
          value.kind,
          value.reason,
          value.sheetValue,
          value.dashboardValue,
          value.sheetFingerprint,
          value.localFingerprint,
        ]);
      if (content(before) !== content(data))
        await execute(
          'INSERT INTO "PersonalFinanceAudit" (id,"userId",action,"entityId",details) VALUES (:id,:userId,\'sheets.conflict.revised\',:entityId,CAST(:details AS jsonb))',
          { id: randomUUID(), userId, entityId: previousId, details: JSON.stringify({ before, after: data }) },
          transaction,
        );
    }
    await execute(
      `INSERT INTO "PersonalFinanceSheetConflicts" (id,"userId",key,"accountId",date,kind,reason,"sheetValue","dashboardValue","sheetFingerprint","localFingerprint") VALUES (:id,:userId,:key,:accountId,:date,:kind,:reason,CAST(:sheetValue AS jsonb),CAST(:dashboardValue AS jsonb),:sheetFingerprint,:localFingerprint) ON CONFLICT ("userId",key) WHERE status='open' DO UPDATE SET date=EXCLUDED.date,reason=EXCLUDED.reason,"sheetValue"=EXCLUDED."sheetValue","dashboardValue"=EXCLUDED."dashboardValue","sheetFingerprint"=EXCLUDED."sheetFingerprint","localFingerprint"=EXCLUDED."localFingerprint"`,
      {
        ...data,
        id: randomUUID(),
        userId,
        sheetValue: JSON.stringify(data.sheetValue),
        dashboardValue: JSON.stringify(data.dashboardValue),
      },
      transaction,
    );
  });
}
export async function runSheetSync(userId: number) {
  return connection.sequelize.transaction(async (transaction: Transaction) => {
    const lock = (
      await query<{ locked: boolean }>(
        'SELECT pg_try_advisory_xact_lock(71404,:userId) AS locked',
        { userId },
        transaction,
      )
    )[0];
    if (!lock?.locked) return { skipped: true, reason: 'already_running' };
    const row = await settings(userId);
    if (!row?.config.enabled) return { skipped: true, reason: 'disabled' };
    await execute('UPDATE "PersonalFinanceSheetSync" SET "lastAttemptAt"=NOW() WHERE "userId"=:userId', { userId });
    try {
      const auth = await credentials(row);
      if (!auth) {
        await execute(
          'UPDATE "PersonalFinanceSheetSync" SET "lastErrorCode"=\'credentials_missing\' WHERE "userId"=:userId',
          { userId },
        );
        return { skipped: true, reason: 'credentials_missing' };
      }
      const dashboardQuery = {
        granularity: 'daily' as const,
        ...(row.config.mirrorSimplefin ? {} : { mode: 'personal' as const }),
      };
      const dashboard = await getFinanceDashboard(userId, dashboardQuery);
      const states = await query<{ key: string; state: CellState }>(
        'SELECT key,state FROM "PersonalFinanceSheetCells" WHERE "userId"=:userId',
        { userId },
      );
      const result = await synchronizeSheet(row.config, googleSheetsTransport(auth), {
        snapshots: dashboard.snapshots,
        flows: dashboard.cashFlows,
        states: new Map(states.map((s) => [s.key, s.state])),
        appendBalance: (data) => appendFinanceSourceSnapshot(userId, data),
        importContributions: (records) => importPrincipalRecords(userId, records),
        saveState: (key, state) => saveState(userId, key, state),
        conflict: (data) => conflict(userId, data),
        currentOriginIds: async () => {
          const current = await getFinanceDashboard(userId, dashboardQuery);
          return new Set([...current.snapshots.map((s) => s.id), ...current.cashFlows.map((f) => f.id)]);
        },
        queue: async (operation: OutboxOperation) => {
          const operationHash = fingerprint(operation);
          const id = randomUUID();
          await execute(
            'UPDATE "PersonalFinanceSheetOutbox" SET status=\'blocked\',"updatedAt"=NOW() WHERE "userId"=:userId AND key=:key AND "operationHash"<>:operationHash AND status=\'pending\'',
            { userId, key: operation.key, operationHash },
          );
          const saved = await query<{ id: string }>(
            'INSERT INTO "PersonalFinanceSheetOutbox" (id,"userId",key,"operationHash",payload) VALUES (:id,:userId,:key,:operationHash,CAST(:payload AS jsonb)) ON CONFLICT ("userId",key,"operationHash") DO UPDATE SET "updatedAt"=NOW(),status=\'pending\' RETURNING id',
            { id, userId, key: operation.key, operationHash, payload: JSON.stringify(operation) },
          );
          return saved[0]!.id;
        },
        complete: (id, status) =>
          execute(
            'UPDATE "PersonalFinanceSheetOutbox" SET status=:status,"updatedAt"=NOW() WHERE id=:id AND "userId"=:userId',
            { id, status, userId },
          ).then(() => undefined),
      });
      await execute(
        'UPDATE "PersonalFinanceSheetSync" SET "lastSuccessAt"=NOW(),"lastErrorCode"=NULL,"lastResult"=CAST(:result AS jsonb) WHERE "userId"=:userId',
        { userId, result: JSON.stringify(result) },
      );
      return result;
    } catch (error) {
      const safeCodes = new Set([
        'google_authorization_failed',
        'oauth_client_missing',
        'sheet_permission_denied',
        'sheet_not_found',
        'google_rate_limited',
        'google_request_failed',
        'duplicate_date_columns',
        'sheet_mapping_changed',
        'date_column_changed',
      ]);
      const code = error instanceof Error && safeCodes.has(error.message) ? error.message : 'synchronization_failed';
      await execute('UPDATE "PersonalFinanceSheetSync" SET "lastErrorCode"=:code WHERE "userId"=:userId', {
        userId,
        code,
      });
      return { failed: true, reason: code };
    }
  });
}
export async function runAllSheetSyncs() {
  const users = await query<{ userId: number }>(
    'SELECT "userId" FROM "PersonalFinanceSheetSync" WHERE (config->>\'enabled\')::boolean',
  );
  let completed = 0;
  for (const user of users) {
    const result = await runSheetSync(user.userId);
    if (!('skipped' in result) && !('failed' in result)) completed++;
  }
  return { configuredUsers: users.length, completed };
}
export async function resolveSheetConflict(userId: number, id: string, resolution: 'sheet' | 'dashboard') {
  const pending = (
    await query<SyncConflict & { id: string }>(
      'SELECT * FROM "PersonalFinanceSheetConflicts" WHERE "userId"=:userId AND id=:id AND status=\'open\'',
      { userId, id },
    )
  )[0];
  if (!pending) fail('Conflict not found.');
  if (pending.kind !== 'balance')
    fail('Review and correct the contribution ledger before resolving a principal conflict.');
  const row = await settings(userId);
  const auth = await credentials(row);
  if (!row || !auth) fail('Google Sheets authorization is required.');
  const mapping = row.config.mappings.find((m) => m.accountId === pending.accountId);
  if (!mapping) fail('Account mapping changed.');
  const transport = googleSheetsTransport(auth);
  const grid = await transport.read(row.config);
  assertMappedRows(grid, row.config);
  const { dateColumns } = await import('./layout');
  const column = dateColumns(grid).get(String(pending.date));
  if (!column) fail('Recorded date column is missing.');
  const remote = cellAt(grid, mapping.balanceRow, column);
  const dashboard = await getFinanceDashboard(userId, {
    granularity: 'daily',
    ...(row.config.mirrorSimplefin ? {} : { mode: 'personal' as const }),
  });
  const local = dashboard.snapshots.find((s) => s.accountId === pending.accountId && s.date === String(pending.date));
  if (cellFingerprint(remote) !== pending.sheetFingerprint || (local?.id ?? 'none') !== pending.localFingerprint)
    fail('This conflict changed; run synchronization and review the current values.');
  if (resolution === 'sheet') {
    const value = cellCents(remote);
    if (value === null) fail('Blank Sheet cells cannot delete recorded balances.');
    const accepted = await addFinanceSnapshot(userId, {
      accountId: pending.accountId,
      date: String(pending.date),
      balance: value / 100,
      verified: true,
      description: `Explicit conflict resolution accepting Google Sheets cell R${mapping.balanceRow}C${column}.`,
    });
    await saveState(userId, pending.key, {
      sheetFingerprint: cellFingerprint(remote),
      snapshotId: accepted.id,
      cents: value,
      row: mapping.balanceRow,
      column,
    });
  } else {
    if (!local || remote.userEnteredValue?.formulaValue) fail('Existing Sheet formulas are protected.');
    const operation: OutboxOperation = {
      key: pending.key,
      kind: 'balance',
      accountId: pending.accountId,
      date: String(pending.date),
      originId: local.id,
      row: mapping.balanceRow,
      column,
      cents: Math.round(local.balance * 100),
      expectedHash: cellFingerprint(remote),
      before: remote,
      note: [remote.note, `MoneyMatter valuation: ${local.id}`, `Effective date: ${local.date}`]
        .filter(Boolean)
        .join('\n'),
    };
    const operationId = randomUUID();
    await execute(
      'INSERT INTO "PersonalFinanceSheetOutbox" (id,"userId",key,"operationHash",payload) VALUES (:id,:userId,:key,:operationHash,CAST(:payload AS jsonb)) ON CONFLICT ("userId",key,"operationHash") DO NOTHING',
      {
        id: operationId,
        userId,
        key: pending.key,
        operationHash: fingerprint(operation),
        payload: JSON.stringify(operation),
      },
    );
    await transport.write(row.config, [
      writeCellRequest(grid, mapping.balanceRow, column, local.balance, operation.note),
    ]);
    const checked = cellAt(await transport.read(row.config), mapping.balanceRow, column);
    if (cellCents(checked) !== Math.round(local.balance * 100))
      fail('Sheet changed during conflict resolution; synchronize again.');
    await saveState(userId, pending.key, {
      sheetFingerprint: cellFingerprint(checked),
      snapshotId: local.id,
      cents: Math.round(local.balance * 100),
      row: mapping.balanceRow,
      column,
    });
  }
  await execute(
    'UPDATE "PersonalFinanceSheetConflicts" SET status=:resolution,"resolvedAt"=NOW() WHERE "userId"=:userId AND id=:id',
    { userId, id, resolution },
  );
  return getSheetSyncStatus(userId);
}
