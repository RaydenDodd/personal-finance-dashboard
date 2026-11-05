import { ValidationError } from '@js/errors';
import { connection } from '@models/index';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { QueryTypes, Transaction } from 'sequelize';

import {
  buildHistory,
  cents,
  money,
  moneyWeightedReturn,
  preferredSnapshots,
  principalFor,
  sourceRank,
} from './calculations';
import { combinedProviderValuation, type LinkedProviderAccount, type ProviderValuation } from './provider-valuation';
import {
  DEFAULT_CATEGORIES,
  type FinanceAccount,
  type FinanceCategory,
  type FinanceCashFlow,
  type FinanceSnapshot,
  type ImportRequest,
} from './types';

type Row = Record<string, any>;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rows = async <T = Row>(
  sql: string,
  replacements: Record<string, unknown> = {},
  transaction?: Transaction,
): Promise<T[]> =>
  connection.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction, logging: false });
const execute = async (sql: string, replacements: Record<string, unknown>, transaction?: Transaction) =>
  connection.sequelize.query(sql, { replacements, transaction, logging: false });
function fail(message: string): never {
  throw new ValidationError({ message });
}
const localDate = (value = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
const locked = <T>(userId: number, work: (transaction: Transaction) => Promise<T>): Promise<T> =>
  connection.sequelize.transaction(async (transaction: Transaction) => {
    await execute('SELECT pg_advisory_xact_lock(71403, :userId)', { userId }, transaction);
    return work(transaction);
  });
async function audit(userId: number, action: string, entityId: string, details: unknown, transaction: Transaction) {
  await execute(
    'INSERT INTO "PersonalFinanceAudit" (id,"userId",action,"entityId",details) VALUES (:id,:userId,:action,:entityId,CAST(:details AS jsonb))',
    { id: randomUUID(), userId, action, entityId, details: JSON.stringify(details) },
    transaction,
  );
}
export async function getFinanceAccounts(userId: number, transaction?: Transaction): Promise<FinanceAccount[]> {
  const accounts = await rows<FinanceAccount>(
    'SELECT * FROM "PersonalFinanceAccounts" WHERE "userId"=:userId ORDER BY "createdAt", id',
    { userId },
    transaction,
  );
  const links = await rows<{ accountId: string; nativeAccountId: string }>(
    'SELECT "accountId","nativeAccountId" FROM "PersonalFinanceAccountLinks" WHERE "userId"=:userId ORDER BY "nativeAccountId"',
    { userId },
    transaction,
  );
  return accounts.map((account) => ({
    ...account,
    nativeAccountIds: links.filter((link) => link.accountId === account.id).map((link) => link.nativeAccountId),
  }));
}
export async function getFinanceCategories(userId: number, transaction?: Transaction): Promise<FinanceCategory[]> {
  const result = await rows<{ categories: FinanceCategory[] }>(
    'SELECT categories FROM "PersonalFinanceSettings" WHERE "userId"=:userId',
    { userId },
    transaction,
  );
  return result[0]?.categories ?? DEFAULT_CATEGORIES;
}
export async function updateFinanceCategories(userId: number, categories: FinanceCategory[]) {
  if (new Set(categories.map((c) => c.id)).size !== categories.length) fail('Category IDs must be unique');
  return locked(userId, async (transaction) => {
    const accounts = await getFinanceAccounts(userId, transaction);
    if (accounts.some((a) => !categories.some((c) => c.id === a.categoryId)))
      fail('Move accounts before removing their category');
    await execute(
      `INSERT INTO "PersonalFinanceSettings" ("userId",categories) VALUES (:userId,CAST(:categories AS jsonb))
      ON CONFLICT ("userId") DO UPDATE SET categories=EXCLUDED.categories,"updatedAt"=NOW()`,
      { userId, categories: JSON.stringify(categories) },
      transaction,
    );
    await audit(userId, 'categories.updated', String(userId), { categories }, transaction);
    return categories;
  });
}
export async function saveFinanceAccount(userId: number, data: Partial<FinanceAccount>, accountId?: string) {
  return locked(userId, async (transaction) => {
    const existing = accountId
      ? (await getFinanceAccounts(userId, transaction)).find((a) => a.id === accountId)
      : undefined;
    if (accountId && !existing) fail('Reporting account not found');
    const merged = {
      currencyCode: 'USD',
      included: true,
      balanceKind: 'asset',
      preferredSource: 'manual',
      nativeAccountId: null,
      description: '',
      ...existing,
      ...data,
    };
    const nativeIds =
      data.nativeAccountIds ??
      (Object.hasOwn(data, 'nativeAccountId')
        ? data.nativeAccountId
          ? [data.nativeAccountId]
          : []
        : (existing?.nativeAccountIds ?? []));
    if (new Set(nativeIds).size !== nativeIds.length) fail('Linked accounts must be unique');
    merged.nativeAccountId = nativeIds.length === 1 ? nativeIds[0]! : null;
    merged.nativeAccountIds = nativeIds;
    const categories = await getFinanceCategories(userId, transaction);
    if (!categories.some((c) => c.id === merged.categoryId)) fail('Unknown category');
    if (nativeIds.length) {
      const native = await rows(
        'SELECT id FROM "Accounts" WHERE id IN (:nativeIds) AND "userId"=:userId',
        { nativeIds, userId },
        transaction,
      );
      if (native.length !== nativeIds.length) fail('Every linked native account must belong to this user');
      const duplicate = await rows(
        'SELECT "accountId" FROM "PersonalFinanceAccountLinks" WHERE "userId"=:userId AND "nativeAccountId" IN (:nativeIds) AND "accountId"<>:id',
        { userId, nativeIds, id: accountId ?? randomUUID() },
        transaction,
      );
      if (duplicate.length) fail('This native account is already mapped to a reporting account');
    }
    if (existing && merged.currencyCode !== existing.currencyCode) {
      const saved = await rows(
        'SELECT id FROM "PersonalFinanceSnapshots" WHERE "accountId"=:id LIMIT 1',
        { id: existing.id },
        transaction,
      );
      if (saved.length) fail('Currency cannot change after snapshots exist; create a separate account');
    }
    const id = accountId ?? randomUUID();
    await execute(
      `INSERT INTO "PersonalFinanceAccounts" (id,"userId",name,"currencyCode","categoryId",included,"balanceKind","nativeAccountId","preferredSource",description)
      VALUES (:id,:userId,:name,:currencyCode,:categoryId,:included,:balanceKind,:nativeAccountId,:preferredSource,:description)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,"currencyCode"=EXCLUDED."currencyCode","categoryId"=EXCLUDED."categoryId",
      included=EXCLUDED.included,"balanceKind"=EXCLUDED."balanceKind","nativeAccountId"=EXCLUDED."nativeAccountId","preferredSource"=EXCLUDED."preferredSource",description=EXCLUDED.description,"updatedAt"=NOW()`,
      { ...merged, id, userId },
      transaction,
    );
    await execute(
      'DELETE FROM "PersonalFinanceAccountLinks" WHERE "accountId"=:id AND "userId"=:userId',
      { id, userId },
      transaction,
    );
    for (const nativeId of nativeIds)
      await execute(
        'INSERT INTO "PersonalFinanceAccountLinks" ("userId","accountId","nativeAccountId") VALUES (:userId,:id,:nativeId)',
        { userId, id, nativeId },
        transaction,
      );
    await audit(
      userId,
      accountId ? 'account.updated' : 'account.created',
      id,
      { before: existing ?? null, after: merged },
      transaction,
    );
    return (await getFinanceAccounts(userId, transaction)).find((a) => a.id === id)!;
  });
}
async function getSnapshots(userId: number, transaction?: Transaction): Promise<FinanceSnapshot[]> {
  const result = await rows<Row>(
    'SELECT * FROM "PersonalFinanceSnapshots" WHERE "userId"=:userId ORDER BY date,"createdAt",id',
    { userId },
    transaction,
  );
  return result.map((r) => ({
    ...r,
    date: String(r.date),
    balance: money(Number(r.balanceCents)),
    createdAt: new Date(r.createdAt).toISOString(),
  })) as FinanceSnapshot[];
}
async function getCashFlows(userId: number, transaction?: Transaction): Promise<FinanceCashFlow[]> {
  const result = await rows<Row>(
    'SELECT * FROM "PersonalFinanceCashFlows" WHERE "userId"=:userId ORDER BY date,"createdAt",id',
    { userId },
    transaction,
  );
  return result.map((r) => ({
    ...r,
    date: String(r.date),
    amount: money(Number(r.amountCents)),
    createdAt: new Date(r.createdAt).toISOString(),
  })) as FinanceCashFlow[];
}
async function insertSnapshot(userId: number, s: Omit<FinanceSnapshot, 'id' | 'createdAt'>, transaction: Transaction) {
  const id = randomUUID();
  const fingerprint = hash(s);
  const result = await rows<{ id: string }>(
    `INSERT INTO "PersonalFinanceSnapshots" (id,"userId","accountId",date,"balanceCents","currencyCode",source,verified,"sourceId","sourceKey",fingerprint,"sourceLabel",formula,description)
    VALUES (:id,:userId,:accountId,:date,:balanceCents,:currencyCode,:source,:verified,:sourceId,:sourceKey,:fingerprint,:sourceLabel,:formula,:description)
    ON CONFLICT ("userId","sourceId","sourceKey",fingerprint) DO UPDATE SET fingerprint=EXCLUDED.fingerprint RETURNING id`,
    { ...s, id, userId, balanceCents: cents(s.balance), fingerprint },
    transaction,
  );
  return result[0]!.id;
}
export async function addFinanceSnapshot(
  userId: number,
  data: { accountId: string; date: string; balance: number; verified: boolean; description?: string },
) {
  return locked(userId, async (transaction) => {
    const account = (await getFinanceAccounts(userId, transaction)).find((a) => a.id === data.accountId);
    if (!account) fail('Account not found');
    const id = await insertSnapshot(
      userId,
      {
        ...data,
        currencyCode: account.currencyCode,
        source: 'manual',
        sourceId: 'manual',
        sourceKey: `${data.accountId}:${data.date}:${randomUUID()}`,
        sourceLabel: account.name,
        formula: null,
        description: data.description ?? '',
      },
      transaction,
    );
    await audit(userId, 'snapshot.appended', id, { accountId: data.accountId, date: data.date }, transaction);
    return { id };
  });
}
export async function addFinanceCashFlow(
  userId: number,
  data: Omit<FinanceCashFlow, 'id' | 'createdAt'> & { idempotencyKey?: string },
) {
  return locked(userId, async (transaction) => {
    if (data.idempotencyKey) {
      const prior = (
        await rows<Row>(
          'SELECT * FROM "PersonalFinanceCashFlows" WHERE "userId"=:userId AND "idempotencyKey"=:key',
          { userId, key: data.idempotencyKey },
          transaction,
        )
      )[0];
      if (prior) {
        if (
          prior.accountId !== data.accountId ||
          prior.date !== data.date ||
          Number(prior.amountCents) !== cents(data.amount) ||
          prior.type !== data.type ||
          prior.toAccountId !== data.toAccountId ||
          prior.opening !== data.opening
        )
          fail('Idempotency key already belongs to a different cash flow');
        return { id: String(prior.id) };
      }
    }
    const accounts = await getFinanceAccounts(userId, transaction);
    const account = accounts.find((a) => a.id === data.accountId);
    if (!account) fail('Account not found');
    const destination = data.toAccountId ? accounts.find((a) => a.id === data.toAccountId) : undefined;
    if (data.type === 'transfer' && (!destination || destination.id === account.id))
      fail('Transfer requires another owned account');
    if (data.type === 'transfer' && destination?.currencyCode !== account.currencyCode)
      fail('Transfers must use the same currency');
    if (data.type !== 'transfer' && data.toAccountId) fail('Destination is only valid for transfers');
    if (data.type !== 'adjustment' && data.amount <= 0) fail('Use a positive amount and select the transaction type');
    if (data.opening && !['adjustment', 'contribution'].includes(data.type))
      fail('Opening basis must be an adjustment or contribution');
    if (
      data.opening &&
      (await getCashFlows(userId, transaction)).some((f) => f.accountId === data.accountId && f.opening)
    )
      fail('An opening basis already exists for this account');
    const id = randomUUID();
    await execute(
      `INSERT INTO "PersonalFinanceCashFlows" (id,"userId","accountId",date,"amountCents",type,"toAccountId",description,opening,"idempotencyKey")
      VALUES (:id,:userId,:accountId,:date,:amountCents,:type,:toAccountId,:description,:opening,:idempotencyKey)
      ON CONFLICT ("userId","idempotencyKey") DO NOTHING`,
      { ...data, id, userId, amountCents: cents(data.amount), idempotencyKey: data.idempotencyKey ?? null },
      transaction,
    );
    await audit(
      userId,
      'cash-flow.appended',
      id,
      { accountId: data.accountId, date: data.date, type: data.type },
      transaction,
    );
    return { id };
  });
}

function normalizedImport(input: ImportRequest) {
  const seen = new Set<string>();
  return input.records.map((r) => {
    cents(r.balance);
    if (seen.has(r.sourceKey)) fail('Duplicate source cell/key in import');
    seen.add(r.sourceKey);
    return {
      accountId: r.accountId,
      date: r.date,
      balance: r.balance,
      currencyCode: r.currencyCode,
      source: input.source ?? 'google-sheets',
      verified: r.verified ?? true,
      sourceId: input.sourceId,
      sourceKey: r.sourceKey,
      sourceLabel: r.sourceLabel ?? '',
      formula: r.formula ?? null,
      description: 'Historical recorded balance; principal is not inferred.',
    };
  });
}
async function prepareImport(userId: number, input: ImportRequest, transaction?: Transaction) {
  const accounts = await getFinanceAccounts(userId, transaction);
  const snapshots = await getSnapshots(userId, transaction);
  const selected = preferredSnapshots(snapshots);
  const records = normalizedImport(input).map((r) => {
    const account = accounts.find((a) => a.id === r.accountId);
    if (!account) fail('Map every source row to an owned reporting account');
    if (account.currencyCode !== r.currencyCode) fail('Import currency does not match account');
    const existing = selected.find((s) => s.accountId === r.accountId && s.date === r.date);
    const duplicate = snapshots.some(
      (s) =>
        s.sourceId === r.sourceId &&
        s.sourceKey === r.sourceKey &&
        s.accountId === r.accountId &&
        s.date === r.date &&
        cents(s.balance) === cents(r.balance) &&
        s.formula === r.formula &&
        s.verified === r.verified,
    );
    const action = duplicate ? 'duplicate' : existing && sourceRank(existing) > sourceRank(r) ? 'protected' : 'insert';
    return { ...r, accountName: account.name, action };
  });
  // Bind review to both the submitted data and current immutable revision set.
  const secret = process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET || process.env.APPLICATION_SECRET;
  if (!secret) fail('Server authentication secret is required for import previews');
  const previewToken = createHmac('sha256', secret)
    .update(JSON.stringify({ userId, records, revisions: snapshots.map((s) => s.id) }))
    .digest('hex');
  const counts = {
    insert: records.filter((r) => r.action === 'insert').length,
    duplicate: records.filter((r) => r.action === 'duplicate').length,
    protected: records.filter((r) => r.action === 'protected').length,
  };
  return {
    previewToken,
    records,
    counts,
    warnings: [
      'Combined historical rows must map to a single historical account until their components are known.',
      'Missing cells are not imported. Historical balances do not establish contributed principal.',
    ],
  };
}
export const previewFinanceImport = (userId: number, input: ImportRequest) => prepareImport(userId, input);
export async function commitFinanceImport(userId: number, input: ImportRequest) {
  return locked(userId, async (transaction) => {
    const preview = await prepareImport(userId, input, transaction);
    if (input.previewToken !== preview.previewToken)
      fail('Import preview changed or was not reviewed; preview again before committing');
    for (const r of preview.records) {
      if (r.action !== 'insert') continue;
      const { action: _action, accountName: _name, ...s } = r;
      await insertSnapshot(userId, s, transaction);
    }
    await audit(userId, 'history.imported', input.sourceId, { counts: preview.counts }, transaction);
    return { ...preview.counts, imported: preview.counts.insert };
  });
}

export async function getFinanceDashboard(
  userId: number,
  query: { from?: string; to?: string; granularity?: 'monthly' | 'daily'; mode?: 'all' | 'personal' } = {},
) {
  const [categories, accounts, allSnapshots, cashFlows] = await Promise.all([
    getFinanceCategories(userId),
    getFinanceAccounts(userId),
    getSnapshots(userId),
    getCashFlows(userId),
  ]);
  const snapshots =
    query.mode === 'personal' ? allSnapshots.filter((s) => !['simplefin', 'plaid'].includes(s.source)) : allSnapshots;
  const firstDates = new Map<string, string>();
  for (const s of snapshots)
    if (!firstDates.has(s.accountId) || s.date < firstDates.get(s.accountId)!) firstDates.set(s.accountId, s.date);
  const allHistory = buildHistory(
    accounts,
    snapshots.filter((s) => !query.to || s.date <= query.to),
    query.granularity ?? 'monthly',
    firstDates,
  );
  const history = allHistory.filter((p) => (!query.from || p.date >= query.from) && (!query.to || p.date <= query.to));
  const selected = preferredSnapshots(snapshots).filter((s) => !query.to || s.date <= query.to);
  const nativeStatuses = await rows<Row>(
    `SELECT a.id,a.type,c."providerType",c."isActive",c."lastSyncAt" FROM "Accounts" a
    LEFT JOIN "BankDataProviderConnections" c ON c.id=a."bankDataProviderConnectionId" WHERE a."userId"=:userId`,
    { userId },
  );
  const accountSummaries = accounts.map((a) => {
    const latest = selected.filter((s) => s.accountId === a.id).at(-1);
    const principal = principalFor(a.id, cashFlows, latest?.date ?? query.to ?? new Date().toISOString().slice(0, 10));
    const gain =
      latest && principal.principal !== null ? money(cents(latest.balance) - cents(principal.principal)) : null;
    const linkedStatuses = (a.nativeAccountIds ?? []).map((id) => nativeStatuses.find((s) => s.id === id));
    const providerObservation = selected
      .filter(
        (s) => s.accountId === a.id && s.source === a.preferredSource && ['simplefin', 'plaid'].includes(s.source),
      )
      .at(-1);
    return {
      ...a,
      latestBalance: latest?.balance ?? null,
      valuationDate: latest?.date ?? null,
      valuationSource: latest?.source ?? null,
      lastSuccessfulSyncAt: providerObservation?.createdAt ?? null,
      connectionLastSuccessfulSyncAt:
        linkedStatuses
          .map((s) => s?.lastSyncAt)
          .filter(Boolean)
          .sort()
          .at(0) ?? null,
      connectionStatus: !linkedStatuses.length
        ? 'manual'
        : linkedStatuses.every((s) => s?.isActive === true)
          ? 'connected'
          : ['simplefin', 'plaid'].includes(a.preferredSource)
            ? 'disconnected'
            : 'manual',
      staleDays: latest
        ? Math.max(0, Math.floor((Date.parse(query.to ?? localDate()) - Date.parse(latest.date)) / 86400000))
        : null,
      verified: latest?.verified ?? false,
      ...principal,
      gain,
      gainPercent:
        gain !== null && principal.principal !== null && principal.principal > 0
          ? (gain / principal.principal) * 100
          : null,
      moneyWeightedReturnPercent: latest ? moneyWeightedReturn(a.id, cashFlows, latest.balance, latest.date) : null,
      returnMethod:
        'Contribution-based gain is not annualized. XIRR requires an explicitly complete inception ledger and at least one year.',
    };
  });
  const last = allHistory.filter((p) => !query.to || p.date <= query.to).at(-1);
  const comparable = (months: number) => {
    if (!last || last.total === null) return null;
    const target = new Date(`${last.date.slice(0, 7)}-01T12:00:00Z`);
    target.setUTCMonth(target.getUTCMonth() - months);
    const month = target.toISOString().slice(0, 7);
    const prior = allHistory.filter((p) => p.date.slice(0, 7) === month && p.total !== null).at(-1);
    return prior
      ? {
          amount: money(cents(last.total) - cents(prior.total!)),
          percent: prior.total === 0 ? null : ((last.total - prior.total!) / Math.abs(prior.total!)) * 100,
          fromDate: prior.date,
          toDate: last.date,
        }
      : null;
  };
  return {
    categories,
    accounts: accountSummaries,
    history,
    cashFlows,
    snapshotCount: snapshots.length,
    total: last?.total ?? null,
    knownTotal: last?.knownTotal ?? null,
    asOf: last?.date ?? null,
    complete: last?.complete ?? false,
    highest: allHistory
      .filter((p) => p.total !== null)
      .reduce<number | null>((max, p) => (max === null || p.total! > max ? p.total! : max), null),
    monthlyChange: comparable(1),
    yearlyChange: comparable(12),
    currencyCode: 'USD',
    snapshots: selected,
    monthlyRuns: (
      await rows<Row>(
        'SELECT month,"missingAccountIds","createdAt" FROM "PersonalFinanceMonthlyRuns" WHERE "userId"=:userId ORDER BY month',
        { userId },
      )
    ).map((run) => ({
      ...run,
      originalMissingAccountIds: run.missingAccountIds,
      missingAccountIds: accounts
        .filter((a) => a.included && !selected.some((s) => s.accountId === a.id && s.date === run.month && s.verified))
        .map((a) => a.id),
    })),
  };
}

export const getFinanceAudit = (userId: number) =>
  rows(
    'SELECT id,action,"entityId",details,"createdAt" FROM "PersonalFinanceAudit" WHERE "userId"=:userId ORDER BY "createdAt" DESC LIMIT 1000',
    { userId },
  );
export const getFinanceRevisions = (userId: number) => getSnapshots(userId);

/** A monthly run records completeness on the exact valuation day. It never copies
 * a newer balance into the past, and missing months stay explicitly partial. */
export async function recordFinanceMonthlyRuns(date = localDate()) {
  const month = `${date.slice(0, 7)}-01`;
  const users = await rows<{ userId: number }>('SELECT DISTINCT "userId" FROM "PersonalFinanceAccounts"');
  for (const { userId } of users)
    await locked(userId, async (transaction) => {
      const accounts = (await getFinanceAccounts(userId, transaction)).filter((a) => a.included);
      const snapshots = preferredSnapshots(await getSnapshots(userId, transaction));
      const missingAccountIds = accounts
        .filter((a) => !snapshots.some((s) => s.accountId === a.id && s.date === month && s.verified))
        .map((a) => a.id);
      await execute(
        `INSERT INTO "PersonalFinanceMonthlyRuns" ("userId",month,"missingAccountIds") VALUES (:userId,:month,CAST(:missing AS jsonb))
      ON CONFLICT ("userId",month) DO NOTHING`,
        { userId, month, missing: JSON.stringify(missingAccountIds) },
        transaction,
      );
    });
}

/** Read-only provider adapter; the same canonical native account can only map once.
 * A provider without an actual valuation timestamp contributes no snapshot. */
export async function captureSimplefinValuations(connectionId: string, values: ProviderValuation[]) {
  const mapped = await rows<FinanceAccount & LinkedProviderAccount & { linkedCount: number }>(
    `SELECT p.*,a."externalId",a.id AS "nativeAccountId",a."currencyCode" AS "nativeCurrencyCode",
    (SELECT COUNT(*) FROM "PersonalFinanceAccountLinks" all_links WHERE all_links."accountId"=p.id) AS "linkedCount" FROM "PersonalFinanceAccounts" p
    JOIN "PersonalFinanceAccountLinks" l ON l."accountId"=p.id AND l."userId"=p."userId"
    JOIN "Accounts" a ON a.id=l."nativeAccountId" AND a."userId"=p."userId"
    WHERE a."bankDataProviderConnectionId"=:connectionId AND p."preferredSource"='simplefin'`,
    { connectionId },
  );
  for (const account of [...new Map(mapped.map((a) => [a.id, a])).values()]) {
    const links = mapped.filter((a) => a.id === account.id);
    if (links.length !== Number(account.linkedCount)) continue;
    const valuation = combinedProviderValuation(links, values, account.currencyCode);
    if (!valuation) continue;
    await locked(account.userId, async (transaction) => {
      await insertSnapshot(
        account.userId,
        {
          accountId: account.id,
          date: valuation.date,
          balance: valuation.balance,
          currencyCode: account.currencyCode,
          source: 'simplefin',
          verified: false,
          sourceId: `simplefin:${connectionId}`,
          sourceKey: `linked:${hash(valuation.keys)}`,
          sourceLabel: account.name,
          formula: null,
          description:
            'Sum of explicitly linked provider accounts on their actual shared valuation day. Manual verified revisions retain priority.',
        },
        transaction,
      );
    });
  }
}
