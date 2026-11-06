import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@models/index', () => ({ connection: { sequelize: { query: jest.fn(), transaction: jest.fn() } } }));
jest.mock('@models/transactions-query', () => ({
  findTransactions: jest.fn(),
  countTransactions: jest.fn(),
  updateTransactions: jest.fn(),
}));
jest.mock('@models/transaction-splits.model', () => ({ __esModule: true, default: { count: jest.fn() } }));
jest.mock('./index', () => ({ getCashFlows: jest.fn(), getFinanceAccounts: jest.fn() }));

import { connection } from '@models/index';
import TransactionSplits from '@models/transaction-splits.model';
import { countTransactions, findTransactions, updateTransactions } from '@models/transactions-query';

import { getCashFlows, getFinanceAccounts } from './index';
import { reconcileFinanceTransfers, savePrincipalTransferRule } from './principal';
import type { FinanceAccount } from './types';

const query = connection.sequelize.query as unknown as jest.Mock<(sql: string, options?: any) => Promise<any>>;
const transact = connection.sequelize.transaction as unknown as jest.Mock<
  (work: (transaction: any) => Promise<unknown>) => Promise<unknown>
>;
const report = (id: string, nativeAccountIds: string[] = []): FinanceAccount => ({
  id,
  userId: 1,
  name: id,
  currencyCode: 'USD',
  categoryId: 'investments',
  included: true,
  balanceKind: 'asset',
  nativeAccountId: null,
  nativeAccountIds,
  preferredSource: 'manual',
  description: '',
  createdAt: '',
});
const confirmation = {
  sourceNativeAccountId: 'checking',
  destinationAccountId: 'investment',
  exactDescription: 'm1',
  effectiveFrom: '2026-11-05',
  isEnabled: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  transact.mockImplementation(async (work) => work({}));
  jest.mocked(getFinanceAccounts).mockResolvedValue([report('investment', ['investment-native'])]);
  jest.mocked(getCashFlows).mockResolvedValue([]);
  jest.mocked(TransactionSplits.count).mockResolvedValue(0);
  jest.mocked(countTransactions).mockResolvedValue(0);
});

describe('confirmed principal funding rules', () => {
  it('reuses a same-destination confirmation when only description case changes', async () => {
    const existing = { ...confirmation, id: 'existing-confirmation', exactDescription: 'M1' };
    query.mockImplementation(async (sql) => {
      if (sql.startsWith('SELECT id,"currencyCode"')) return [{ id: 'checking', currencyCode: 'USD' }];
      if (sql.startsWith('SELECT * FROM "PersonalFinancePrincipalTransferRules"')) return [existing];
      return [];
    });
    expect((await savePrincipalTransferRule(1, confirmation)).id).toBe(existing.id);
    expect(
      query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO "PersonalFinancePrincipalTransferRules"')),
    ).toBe(false);
    expect(
      query.mock.calls.find(([sql]) => sql.startsWith('UPDATE "PersonalFinancePrincipalTransferRules"'))?.[1]
        .replacements.ids,
    ).toEqual([existing.id]);
  });

  it('rejects a case variant pointing to a different account without overwriting the original', async () => {
    query.mockImplementation(async (sql) => {
      if (sql.startsWith('SELECT id,"currencyCode"')) return [{ id: 'checking', currencyCode: 'USD' }];
      if (sql.startsWith('SELECT * FROM "PersonalFinancePrincipalTransferRules"'))
        return [{ ...confirmation, id: 'original', exactDescription: 'M1', destinationAccountId: 'retirement' }];
      return [];
    });
    await expect(savePrincipalTransferRule(1, confirmation)).rejects.toThrow(
      'already confirmed for another principal account',
    );
    expect(
      query.mock.calls.some(([sql]) => /^(?:INSERT INTO|UPDATE) "PersonalFinancePrincipalTransferRules"/.test(sql)),
    ).toBe(false);
  });

  it('reviews an owned investment or savings source with no reporting identity instead of creating external principal', async () => {
    const amount = Money.fromDecimal(200);
    const base = {
      transferId: 'owned-pair',
      transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      currencyCode: 'USD',
      amount,
      time: new Date('2026-11-06T12:00:00Z'),
      externalData: null,
      refundLinked: false,
      paymentParentId: null,
    };
    jest.mocked(findTransactions).mockResolvedValue([
      {
        ...base,
        id: 'withdrawal',
        accountId: 'unmapped-source',
        note: 'Transfer to investment',
        transactionType: TRANSACTION_TYPES.expense,
      },
      {
        ...base,
        id: 'deposit',
        accountId: 'investment-native',
        note: 'Transfer received',
        transactionType: TRANSACTION_TYPES.income,
      },
    ] as any);
    for (const accountCategory of ['saving', 'investment']) {
      query.mockClear();
      query.mockImplementation(async (sql) => {
        if (sql.startsWith('SELECT "bankHistoryMappings"')) return [{ bankHistoryMappings: [] }];
        if (sql.startsWith('SELECT id,"accountCategory"'))
          return [
            { id: 'unmapped-source', accountCategory },
            { id: 'investment-native', accountCategory: 'investment' },
          ];
        return [];
      });
      const result = await reconcileFinanceTransfers(1);
      expect(result).toMatchObject({ inserted: 0, linked: 0, pending: 1 });
      expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO "PersonalFinanceCashFlows"'))).toBe(false);
      const savedReview = query.mock.calls.find(([sql]) =>
        sql.startsWith('INSERT INTO "PersonalFinancePrincipalReviews"'),
      )?.[1].replacements;
      expect(savedReview.reason).toContain('source needs a reporting-account mapping');
      expect(JSON.parse(savedReview.details).sourceAccountIds).toEqual([]);
    }
    expect(updateTransactions).not.toHaveBeenCalled();
  });
});
