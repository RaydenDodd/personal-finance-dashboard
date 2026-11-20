import { ACCOUNT_CATEGORIES, BANK_PROVIDER_TYPE, type HistoricalTransactionRow } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { executeHistory, previewHistory } from '@tests/helpers/historical-import';
import { SIMPLEFIN_ACCOUNT_1, getMockedSimplefinAccountSet } from '@tests/mocks/simplefin/data';
import { VALID_SIMPLEFIN_SETUP_TOKEN, getSimplefinAccountsMock } from '@tests/mocks/simplefin/mock-api';

const connectAccount = async () => {
  global.mswMockServer.use(
    getSimplefinAccountsMock({ response: getMockedSimplefinAccountSet({ account1Transactions: [] }) }),
  );
  const { connectionId } = await helpers.bankDataProviders.connectProvider({
    providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
    credentials: { setupToken: VALID_SIMPLEFIN_SETUP_TOKEN },
    raw: true,
  });
  const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
    connectionId,
    accountExternalIds: [SIMPLEFIN_ACCOUNT_1],
    raw: true,
  });
  const accountId = syncedAccounts[0]!.id;
  await helpers.updateAccount({ id: accountId, payload: { accountCategory: ACCOUNT_CATEGORIES.cash }, raw: true });
  return accountId;
};
const sourceRow = ({
  accountId,
  overrides = {},
}: {
  accountId: string;
  overrides?: Partial<HistoricalTransactionRow>;
}): HistoricalTransactionRow => ({
  accountId,
  date: '2024-10-25',
  signedAmountCents: -1275,
  description: 'Historical grocery store',
  source: {
    key: 'old-purchase',
    fileName: 'bank.csv',
    fileHash: 'a'.repeat(64),
    sheet: 'CSV',
    row: 2,
    institution: 'Test Bank',
    transactionDate: '2024-10-25',
  },
  ...overrides,
});

describe('historical imports through the canonical transaction API', () => {
  it('returns an empty read-only preview', async () => {
    const preview = await previewHistory({ rows: [], raw: true });
    expect(preview.counts).toEqual({ new: 0, existing: 0, 'source-duplicate': 0, review: 0 });
  });
  it('retains a normalized merchant and links an existing owner payee', async () => {
    const accountId = await connectAccount();
    const payee = await helpers.createPayee({
      payload: { name: 'Historical River Cafe', defaultCategoryId: global.DEFAULT_CATEGORY_ID },
      raw: true,
    });
    const rows = [
      sourceRow({
        accountId,
        overrides: { merchantName: payee.name, payeeId: payee.id, description: 'TST* Historical River Cafe' },
      }),
    ];
    const preview = await previewHistory({ rows, raw: true });
    const result = await executeHistory({ rows, previewToken: preview.previewToken, raw: true });
    const [saved] = await helpers.getTransactionsByIds({ ids: result.createdIds, raw: true });
    expect(saved!.note).toBe('TST* Historical River Cafe');
    expect(saved!.merchantName).toBe(payee.name);
    expect(saved!.payeeId).toBe(payee.id);
  });
  it('imports 2024 history once while retaining the live balance', async () => {
    const accountId = await connectAccount();
    const before = await helpers.getAccount({ id: accountId, raw: true });
    const rows = [sourceRow({ accountId })];
    const preview = await previewHistory({ rows, raw: true });
    expect(preview.counts.new).toBe(1);
    const first = await executeHistory({ rows, previewToken: preview.previewToken, raw: true });
    expect(first.createdIds).toHaveLength(1);
    const again = await previewHistory({ rows, raw: true });
    expect(again.counts.new).toBe(0);
    const second = await executeHistory({ rows, previewToken: again.previewToken, raw: true });
    expect(second.createdIds).toHaveLength(0);
    const after = await helpers.getAccount({ id: accountId, raw: true });
    expect(after.currentBalance).toEqual(before.currentBalance);
    expect(after.initialBalance).toEqual(before.initialBalance);
    expect(after.type).toBe(before.type);
  });
  it('accepts a normal export larger than the default JSON body limit', async () => {
    const accountId = await connectAccount();
    const base = sourceRow({ accountId });
    const rows = Array.from({ length: 250 }, (_, index) => ({
      ...base,
      description: `Historical purchase ${index} ${'merchant detail '.repeat(12)}`,
      source: { ...base.source, key: `purchase-${index}`, row: index + 2 },
    }));
    expect(Buffer.byteLength(JSON.stringify({ rows }))).toBeGreaterThan(100 * 1024);
    expect((await previewHistory({ rows, raw: true })).decisions).toHaveLength(250);
  });
  it('reconciles CSV/XLSX overlap and preserves legitimate repeated purchases', async () => {
    const accountId = await connectAccount();
    const first = sourceRow({ accountId });
    const repeat = sourceRow({
      accountId,
      overrides: { source: { ...first.source, key: 'another-purchase', bankId: 'bank-2', row: 3 } },
    });
    first.source.bankId = 'bank-1';
    const overlapping = {
      ...first,
      source: { ...first.source, fileName: 'bank.xlsx', fileHash: 'b'.repeat(64), sheet: 'Details' },
    };
    const rows = [first, repeat, overlapping];
    const preview = await previewHistory({ rows, raw: true });
    expect(preview.counts.new).toBe(2);
    expect(preview.counts['source-duplicate']).toBe(1);
    const result = await executeHistory({ rows, previewToken: preview.previewToken, raw: true });
    expect(result.createdIds).toHaveLength(2);
  });
  it('rejects unmapped/system accounts and malformed dates', async () => {
    const account = await helpers.createAccount({ raw: true });
    const response = await previewHistory({ rows: [sourceRow({ accountId: account.id })] });
    expect(response.statusCode).toBe(422);
    const invalid = await previewHistory({
      rows: [sourceRow({ accountId: account.id, overrides: { date: '2024-02-30' } })],
    });
    expect(invalid.statusCode).toBe(422);
  });
  it('rejects a stale execution token without creating transactions', async () => {
    const accountId = await connectAccount();
    const response = await executeHistory({ rows: [sourceRow({ accountId })], previewToken: '0'.repeat(64) });
    expect(response.statusCode).toBe(409);
    const preview = await previewHistory({ rows: [sourceRow({ accountId })], raw: true });
    expect(preview.counts.new).toBe(1);
  });
  it('records transfers and refunds without manufacturing opposite transactions', async () => {
    const accountId = await connectAccount();
    const purchase = sourceRow({ accountId });
    const refund = sourceRow({
      accountId,
      overrides: {
        signedAmountCents: 1275,
        isRefund: true,
        refundForSourceKey: purchase.source.key,
        source: { ...purchase.source, key: 'refund', row: 3 },
      },
    });
    const transfer = sourceRow({
      accountId,
      overrides: {
        isTransfer: true,
        signedAmountCents: -50000,
        source: { ...purchase.source, key: 'savings-transfer', row: 4 },
      },
    });
    const rows = [refund, purchase, transfer];
    const preview = await previewHistory({ rows, raw: true });
    const result = await executeHistory({ rows, previewToken: preview.previewToken, raw: true });
    expect(result.createdIds).toHaveLength(3);
    expect((await previewHistory({ rows, raw: true })).counts.new).toBe(0);
  });
});
