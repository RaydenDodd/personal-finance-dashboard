import { TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@models/transactions-query', () => ({
  findOneTransaction: jest.fn(),
  findTransactions: jest.fn(),
  updateTransactions: jest.fn(),
}));
jest.mock('@i18n/index', () => ({ t: ({ key }: { key: string }) => key }));
jest.mock('./historical-account-lock', () => ({ lockHistoricalAccount: jest.fn() }));

import { findOneTransaction, findTransactions, updateTransactions } from '@models/transactions-query';

import { lockHistoricalAccount } from './historical-account-lock';
import { reconcileHistoricalProviderRow } from './reconcile-historical-provider-row';

const historical = ({ id = 'historical-1', description = 'River Cafe', signed = -1250 } = {}) => ({
  id,
  accountId: 'owned-card',
  originalId: `history:${id}`,
  time: new Date('2024-12-31T12:00:00Z'),
  amount: Money.fromCents(Math.abs(signed)),
  transactionType: signed < 0 ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income,
  note: description,
  categoryId: 'owner-corrected-category',
  categorizationMeta: { source: 'manual' },
  externalData: {
    mcc: '5812',
    historicalSources: [
      {
        key: id,
        fileName: 'old-card.csv',
        fileHash: 'a'.repeat(64),
        sheet: 'CSV',
        row: 2,
        institution: 'Bank',
        transactionDate: '2024-12-31',
      },
    ],
  },
  update: jest.fn(async () => undefined),
  setDataValue: jest.fn(),
});

const incoming = () => ({
  accountId: 'owned-card',
  userId: 1,
  originalId: 'provider-transaction-1',
  amount: Money.fromCents(1250),
  transactionType: TRANSACTION_TYPES.expense,
  time: new Date('2024-12-31T18:00:00Z'),
  description: 'TST* River Cafe',
  externalData: { posted: 1735668000, mcc: null, payee: '', memo: undefined },
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(findOneTransaction).mockResolvedValue(null);
  jest.mocked(findTransactions).mockResolvedValue([]);
  jest.mocked(updateTransactions).mockResolvedValue([1]);
});

describe('later provider synchronization against historical imports', () => {
  it('serializes with import execution before checking identifiers', async () => {
    await reconcileHistoricalProviderRow(incoming());
    expect(lockHistoricalAccount).toHaveBeenCalledWith({ accountId: 'owned-card' });
    expect(jest.mocked(lockHistoricalAccount).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(findOneTransaction).mock.invocationCallOrder[0]!,
    );
  });

  it('retains an existing exact provider identity without another candidate scan or write', async () => {
    const existing = historical();
    jest.mocked(findOneTransaction).mockResolvedValue(existing as never);
    expect(await reconcileHistoricalProviderRow(incoming())).toBe(existing);
    expect(findTransactions).not.toHaveBeenCalled();
    expect(updateTransactions).not.toHaveBeenCalled();
    expect(existing.update).not.toHaveBeenCalled();
  });

  it('leaves normal provider creation available when no historical row exists', async () => {
    expect(await reconcileHistoricalProviderRow(incoming())).toBeNull();
    expect(findTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ access: { accountOwner: 1 }, planned: 'exclude', completeness: 'all' }),
    );
  });

  it('claims a unique historical transaction without changing its financial identity or manual category', async () => {
    const existing = historical();
    jest.mocked(findTransactions).mockResolvedValue([existing] as never);
    expect(await reconcileHistoricalProviderRow(incoming())).toBe(existing);
    expect(updateTransactions).toHaveBeenCalledTimes(1);
    const externalData = { ...existing.externalData, posted: 1735668000 };
    expect(updateTransactions).toHaveBeenCalledWith({
      access: { accountOwner: 1 },
      planned: 'exclude',
      balanceAdjustments: 'exclude',
      where: { id: existing.id, accountId: existing.accountId },
      values: { originalId: 'provider-transaction-1', externalData },
      individualHooks: false,
    });
    expect(existing.update).not.toHaveBeenCalled();
    expect(existing.setDataValue).toHaveBeenCalledWith('originalId', 'provider-transaction-1');
    expect(existing.setDataValue).toHaveBeenCalledWith('externalData', externalData);
    expect(existing.categoryId).toBe('owner-corrected-category');
    expect(existing.categorizationMeta).toEqual({ source: 'manual' });
  });

  it('adds nonblank bank metadata while retaining import provenance', async () => {
    const existing = historical();
    jest.mocked(findTransactions).mockResolvedValue([existing] as never);
    const input = incoming();
    await reconcileHistoricalProviderRow({ ...input, externalData: { payee: 'River Cafe', mcc: '5813' } });
    expect(updateTransactions).toHaveBeenCalledWith({
      access: { accountOwner: 1 },
      planned: 'exclude',
      balanceAdjustments: 'exclude',
      where: { id: existing.id, accountId: existing.accountId },
      values: {
        originalId: input.originalId,
        externalData: { ...existing.externalData, payee: 'River Cafe', mcc: '5813' },
      },
      individualHooks: false,
    });
    expect(existing.update).not.toHaveBeenCalled();
  });

  it('does not merge a refund with a same-amount purchase', async () => {
    const existing = historical({ signed: 1250 });
    jest.mocked(findTransactions).mockResolvedValue([existing] as never);
    expect(await reconcileHistoricalProviderRow(incoming())).toBeNull();
    expect(existing.update).not.toHaveBeenCalled();
  });

  it('holds indistinguishable historical purchases instead of merging either one', async () => {
    const first = historical();
    const second = historical({ id: 'historical-2' });
    jest.mocked(findTransactions).mockResolvedValue([first, second] as never);
    await expect(reconcileHistoricalProviderRow(incoming())).rejects.toThrow('historicalImport.syncConflict');
    expect(first.update).not.toHaveBeenCalled();
    expect(second.update).not.toHaveBeenCalled();
    expect(updateTransactions).not.toHaveBeenCalled();
  });

  it('holds a same-amount transaction with a conflicting merchant description', async () => {
    const existing = historical({ description: 'Book Shop' });
    jest.mocked(findTransactions).mockResolvedValue([existing] as never);
    await expect(reconcileHistoricalProviderRow(incoming())).rejects.toThrow('historicalImport.syncConflict');
    expect(existing.update).not.toHaveBeenCalled();
    expect(updateTransactions).not.toHaveBeenCalled();
  });

  it('matches a unique posting date across the year boundary', async () => {
    const existing = historical();
    jest.mocked(findTransactions).mockResolvedValue([existing] as never);
    expect(await reconcileHistoricalProviderRow({ ...incoming(), time: new Date('2025-01-02T12:00:00Z') })).toBe(
      existing,
    );
  });

  it('reuses a cached money-bearing record for metadata writes without invoking balance hooks', async () => {
    const existing = historical();
    const amount = existing.amount;
    jest.mocked(findTransactions).mockResolvedValue([existing] as never);
    await reconcileHistoricalProviderRow(incoming());
    await reconcileHistoricalProviderRow(incoming());
    expect(existing.amount).toBe(amount);
    expect(existing.amount.toCents()).toBe(1250);
    expect(existing.update).not.toHaveBeenCalled();
    expect(updateTransactions).toHaveBeenCalledTimes(2);
    for (const [options] of jest.mocked(updateTransactions).mock.calls) {
      expect(options.individualHooks).toBe(false);
      expect(Object.keys(options.values).toSorted()).toEqual(['externalData', 'originalId']);
    }
  });
});
