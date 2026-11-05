import { TRANSACTION_TRANSFER_NATURE as Nature } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@models/transactions.model', () => ({
  __esModule: true,
  default: {},
  updateTransactionById: jest.fn(async () => ({})),
}));
jest.mock('@models/transactions-query', () => ({ findOneTransaction: jest.fn(), countTransactions: jest.fn() }));
jest.mock('@models/transaction-tags.model', () => ({ __esModule: true, default: { bulkCreate: jest.fn() } }));
jest.mock('@models/transaction-splits.model', () => ({ __esModule: true, default: { count: jest.fn() } }));
jest.mock('@services/common/event-bus', () => ({ eventBus: { emit: jest.fn() }, DOMAIN_EVENTS: {} }));
jest.mock('@services/transactions/payment-legs', () => ({ syncPaymentLegs: jest.fn() }));

import TransactionSplits from '@models/transaction-splits.model';
import { countTransactions, findOneTransaction } from '@models/transactions-query';
import { updateTransactionById } from '@models/transactions.model';

import { applyActions } from './apply-actions';

const row = {
  id: 'owned-row',
  paymentParentId: null,
  transferId: null,
  transferNature: Nature.not_transfer,
  refundLinked: false,
  isPlanned: false,
  externalData: null,
};
const run = (extra = {}) => {
  jest.mocked(findOneTransaction).mockResolvedValue({ ...row, ...extra } as any);
  return applyActions({
    transaction: { ...row, ...extra } as any,
    rule: { id: 'owned-rule', actions: [{ type: 'mark_transfer' }] } as any,
    userId: 1,
    skipSetCategory: false,
  });
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(TransactionSplits.count).mockResolvedValue(0);
  jest.mocked(countTransactions).mockResolvedValue(0);
});
describe('explicit transfer classification automation', () => {
  it('changes only the classification of the existing owner row', async () => {
    expect(await run()).toBe(true);
    expect(updateTransactionById).toHaveBeenCalledWith({
      id: 'owned-row',
      userId: 1,
      transferNature: Nature.transfer_out_wallet,
    });
  });
  it('preserves linked, refunded, planned and pending transactions', async () => {
    for (const extra of [
      { transferId: 'linked' },
      { transferNature: Nature.common_transfer },
      { refundLinked: true },
      { isPlanned: true },
      { paymentParentId: 'parent' },
      { externalData: { rawTransaction: { status: 'PDNG' } } },
    ]) {
      expect(await run(extra)).toBe(false);
    }
    expect(updateTransactionById).not.toHaveBeenCalled();
  });
  it('keeps split payments and multiple-account payment allocations intact', async () => {
    jest.mocked(TransactionSplits.count).mockResolvedValue(1);
    expect(await run()).toBe(false);
    jest.mocked(TransactionSplits.count).mockResolvedValue(0);
    jest.mocked(countTransactions).mockResolvedValue(1);
    expect(await run()).toBe(false);
    expect(updateTransactionById).not.toHaveBeenCalled();
  });
});
