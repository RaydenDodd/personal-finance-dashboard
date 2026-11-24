import { ACCOUNT_TYPES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type Accounts from '@models/accounts.model';
import { findOneTransaction } from '@models/transactions-query';
import { createTransaction } from '@services/transactions';

jest.mock('@models/transactions-query', () => ({ findOneTransaction: jest.fn() }));
jest.mock('@models/users.model', () => ({ getUserDefaultCategory: jest.fn(async () => 'default') }));
jest.mock('@services/transactions', () => ({ createTransaction: jest.fn() }));
jest.mock('@services/transactions/planned-matching', () => ({ accountHasPlannedRows: jest.fn(async () => false) }));
jest.mock('./notify-planned-confirmations', () => ({ notifyPlannedConfirmations: jest.fn() }));

import { persistSyncedTransactions } from './persist-synced-transactions';

const row = {
  originalId: 'provider-1',
  time: new Date('2026-11-01T12:00:00Z'),
  amount: '-12.34',
  note: 'merchant',
  externalData: { mcc: '5814' },
};
const sync = () =>
  persistSyncedTransactions({
    account: { id: 'account-1' } as Accounts,
    userId: 1,
    accountType: ACCOUNT_TYPES.simplefin,
    rows: [row],
    matchPlanned: false,
    checkpoint: async () => {},
  });
beforeEach(() => {
  jest.resetAllMocks();
});
describe('historical import protection during provider persistence', () => {
  it('enriches MCC without replacing a corrected category, amount or provenance', async () => {
    const update = jest.fn(async () => {});
    jest.mocked(findOneTransaction).mockResolvedValueOnce({ externalData: { historicalSource: 'csv' }, update } as any);
    const result = await sync();
    expect(update).toHaveBeenCalledWith({ externalData: { historicalSource: 'csv', mcc: '5814' } });
    expect(createTransaction).not.toHaveBeenCalled();
    expect(result.createdTransactionIds).toEqual([]);
  });
  it('does not emit a reconciled historical record for recategorization', async () => {
    jest.mocked(findOneTransaction).mockResolvedValue(null);
    jest
      .mocked(createTransaction)
      .mockResolvedValue(Object.assign([{ id: 'existing-historical' }], { reconciledHistorical: true }) as any);
    const result = await sync();
    expect(createTransaction).toHaveBeenCalledTimes(1);
    expect(result.createdTransactionIds).toEqual([]);
    expect(result.mergedIntoPlannedCount).toBe(0);
  });
});

describe('late-posting SimpleFIN transactions', () => {
  it('imports by posting date, preserves purchase date, and skips it on repeated syncs', async () => {
    const created = new Map<string, any>();
    jest
      .mocked(findOneTransaction)
      .mockImplementation(async (query: any) => created.get(query.where?.originalId) ?? null);
    jest.mocked(createTransaction).mockImplementation(async (payload: any) => {
      const existing = { id: 'late-row', externalData: payload.externalData, update: jest.fn() };
      created.set(payload.originalId, existing);
      return [existing] as any;
    });
    const run = () =>
      persistSyncedTransactions({
        account: { id: 'account-1' } as Accounts,
        userId: 1,
        accountType: ACCOUNT_TYPES.simplefin,
        matchPlanned: false,
        checkpoint: async () => {},
        createFromDate: new Date('2026-11-19Z'),
        rows: [{ ...row, time: new Date('2026-11-10Z'), postedAt: new Date('2026-11-22Z') }],
      });
    expect((await run()).createdTransactionIds).toEqual(['late-row']);
    expect((await run()).createdTransactionIds).toEqual([]);
    expect(createTransaction).toHaveBeenCalledTimes(1);
    expect(jest.mocked(createTransaction).mock.calls[0]![0].time).toEqual(new Date('2026-11-10Z'));
  });
});
