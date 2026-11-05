import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { connection } from '@models/index';

jest.mock('@models/index', () => ({ connection: { sequelize: { query: jest.fn(), transaction: jest.fn() } } }));

import { addFinanceSnapshot, commitFinanceImport, getFinanceDashboard, getFinanceRevisions, previewFinanceImport, saveFinanceAccount } from './index';

// An in-memory persistence boundary, not a replacement for the real PostgreSQL
// migration check. It exercises the service review/commit/revision behavior.
let saved: any[];
const account = { id: 'a', userId: 1, name: 'Synthetic investment', currencyCode: 'USD', categoryId: 'investments', included: true,
  balanceKind: 'asset', preferredSource: 'manual', nativeAccountId: null, description: '', createdAt: '' };
beforeEach(() => {
  saved = [];
  process.env.BETTER_AUTH_SECRET = 'synthetic-unit-test-secret-not-used-in-production';
  connection.sequelize.transaction.mockImplementation(async (callback: (transaction: object) => Promise<unknown>) => callback({}));
  connection.sequelize.query.mockImplementation(async (sql: string, options: any) => {
    const r = options.replacements ?? {};
    if (sql.startsWith('SELECT * FROM "PersonalFinanceAccounts"')) return r.userId === 1 ? [account] : [];
    if (sql.startsWith('SELECT * FROM "PersonalFinanceSnapshots"')) return saved.filter((s) => s.userId === r.userId);
    if (sql.startsWith('INSERT INTO "PersonalFinanceSnapshots"')) {
      const prior = saved.find((s) => s.userId === r.userId && s.sourceId === r.sourceId && s.sourceKey === r.sourceKey && s.fingerprint === r.fingerprint);
      if (prior) return [{ id: prior.id }];
      saved.push({ ...r, revision: saved.length + 1, createdAt: '2026-01-01T00:00:00.000Z' });
      return [{ id: r.id }];
    }
    return [];
  });
});

const importRequest = { sourceId: 'synthetic-workbook:tab', records: [{ sourceKey: 'B4', accountId: 'a', date: '2022-06-15', balance: 123.45, currencyCode: 'USD', sourceLabel: 'Historical investment', verified: true }] };

describe('historical review, import and immutable corrections', () => {
  it('previews exact dated balances without persisting and imports idempotently on a rerun', async () => {
    const preview = await previewFinanceImport(1, importRequest);
    expect(preview.records[0]).toMatchObject({ date: '2022-06-15', balance: 123.45, action: 'insert' });
    expect(saved).toHaveLength(0);
    expect(await commitFinanceImport(1, { ...importRequest, previewToken: preview.previewToken })).toMatchObject({ imported: 1 });
    const repeat = await previewFinanceImport(1, importRequest);
    expect(repeat.counts).toEqual({ insert: 0, duplicate: 1, protected: 0 });
    await commitFinanceImport(1, { ...importRequest, previewToken: repeat.previewToken });
    expect(saved).toHaveLength(1);
  });
  it('rejects a changed payload after preview and an unmapped foreign-user account', async () => {
    const preview = await previewFinanceImport(1, importRequest);
    await expect(commitFinanceImport(1, { ...importRequest, records: [{ ...importRequest.records[0]!, balance: 999 }], previewToken: preview.previewToken })).rejects.toThrow(/preview/);
    await expect(previewFinanceImport(2, importRequest)).rejects.toThrow(/owned/);
    expect(saved).toHaveLength(0);
  });
  it('rejects duplicate source cell identities instead of counting the same row twice', async () => {
    await expect(previewFinanceImport(1, { ...importRequest, records: [...importRequest.records, ...importRequest.records] })).rejects.toThrow(/Duplicate source/);
    expect(saved).toHaveLength(0);
  });
  it('protects manually verified history from an imported lower-quality value', async () => {
    await addFinanceSnapshot(1, { accountId: 'a', date: '2022-06-15', balance: 200, verified: true });
    const preview = await previewFinanceImport(1, importRequest);
    expect(preview.counts.protected).toBe(1);
    await commitFinanceImport(1, { ...importRequest, previewToken: preview.previewToken });
    expect(saved).toHaveLength(1);
    expect((await getFinanceDashboard(1)).accounts[0]!.latestBalance).toBe(200);
  });
  it('preserves every manual revision including reverting to an original value', async () => {
    for (const balance of [100, 110, 100]) await addFinanceSnapshot(1, { accountId: 'a', date: '2026-01-01', balance, verified: true });
    expect((await getFinanceRevisions(1)).map((s) => s.balance)).toEqual([100, 110, 100]);
    expect((await getFinanceDashboard(1)).accounts[0]!.latestBalance).toBe(100);
  });
  it('filters valuations before monthly aggregation for an earlier as-of date', async () => {
    await addFinanceSnapshot(1, { accountId: 'a', date: '2026-01-05', balance: 100, verified: true });
    await addFinanceSnapshot(1, { accountId: 'a', date: '2026-01-25', balance: 200, verified: true });
    const dashboard = await getFinanceDashboard(1, { to: '2026-01-10' });
    expect(dashboard.total).toBe(100); expect(dashboard.highest).toBe(100); expect(dashboard.history[0]!.date).toBe('2026-01-05');
  });
  it('invalidates a prior import preview when manual history changes', async () => {
    const preview = await previewFinanceImport(1, importRequest);
    await addFinanceSnapshot(1, { accountId: 'a', date: '2022-06-15', balance: 200, verified: true });
    await expect(commitFinanceImport(1, { ...importRequest, previewToken: preview.previewToken })).rejects.toThrow(/preview/);
  });
  it('rejects updating another user’s reporting account or linking an unowned native account', async () => {
    await expect(saveFinanceAccount(2, { name: 'Unauthorized edit' }, 'a')).rejects.toThrow(/not found/);
    await expect(saveFinanceAccount(1, { name: 'Synthetic', categoryId: 'investments', nativeAccountId: 'foreign-native' })).rejects.toThrow(/belong to this user/);
    await expect(addFinanceSnapshot(2, { accountId: 'a', date: '2026-01-01', balance: 1, verified: true })).rejects.toThrow(/not found/);
    expect(saved).toHaveLength(0);
  });
});
