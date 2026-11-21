import { Money } from '@common/types/money';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

jest.mock('@js/utils/posthog', () => ({ trackMcpToolUsed: jest.fn() }));
jest.mock('@services/transactions/create-transaction', () => ({ createTransaction: jest.fn() }));
jest.mock('@services/transactions/update-transaction', () => ({ updateTransaction: jest.fn() }));
jest.mock('@services/transactions/bulk-update', () => ({ bulkUpdate: jest.fn() }));

import { bulkUpdate } from '@services/transactions/bulk-update';
import { createTransaction } from '@services/transactions/create-transaction';
import { updateTransaction } from '@services/transactions/update-transaction';
import { captureTools, makeExtra } from '@tests/helpers/mcp-tools';

// Blocks the real services, whose import chains build queues at module scope and
// would open Redis connections in a unit test.
jest.mock('@services/transactions/create-transaction', () => ({ createTransaction: jest.fn() }));
jest.mock('@services/transactions/update-transaction', () => ({ updateTransaction: jest.fn() }));
jest.mock('@services/transactions/bulk-update', () => ({ bulkUpdate: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));
jest.mock('@root/serializers', () => ({
  ...(jest.requireActual('@root/serializers') as object),
  serializeTransactionTuple: jest.fn(() => []),
}));
jest.mock('@root/serializers/transactions.serializer', () => ({
  ...(jest.requireActual('@root/serializers/transactions.serializer') as object),
  serializeTransactionTuple: jest.fn(() => []),
}));

import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { bulkUpdateTransactionsTool } from './bulk-update-transactions';
import { createTransactionTool } from './create-transaction';
import { updateTransactionTool } from './update-transaction';

const ID = '019f7e9e-b5f4-729c-9881-9544b15f4e3d';
const PAYEE_ID = '019f7e9e-b5f4-729c-9881-9544b15f4e4e';
const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });

const create = captureTools({ register: createTransactionTool })[0]!;
const update = captureTools({ register: updateTransactionTool })[0]!;
const bulk = captureTools({ register: bulkUpdateTransactionsTool })[0]!;

const createArgs = {
  accountId: ID,
  amount: 10,
  transactionType: 'expense',
  paymentType: 'cash',
  transferNature: 'not_transfer',
  categoryId: ID,
};

describe('MCP transaction tools forward payeeId', () => {
  let previousReadOnly: string | undefined;
  beforeEach(() => {
    previousReadOnly = process.env.MCP_READ_ONLY;
    process.env.MCP_READ_ONLY = 'false';
    jest.mocked(createTransaction).mockRejectedValue(new Error('stop'));
    jest.mocked(updateTransaction).mockRejectedValue(new Error('stop'));
    jest.mocked(bulkUpdate).mockRejectedValue(new Error('stop'));
  });
  afterEach(() => { if (previousReadOnly === undefined) delete process.env.MCP_READ_ONLY; else process.env.MCP_READ_ONLY = previousReadOnly; });

  it('passes payeeId to the service', async () => {
    await create.handler({ ...createArgs, payeeId: PAYEE_ID }, WRITE);

    expect(createTransaction).toHaveBeenCalledWith(expect.objectContaining({ payeeId: PAYEE_ID }));
  });

  it('passes merchantName to the service as rawMerchantName', async () => {
    await create.handler({ ...createArgs, merchantName: 'Starbucks' }, WRITE);

    expect(createTransaction).toHaveBeenCalledWith(expect.objectContaining({ rawMerchantName: 'Starbucks' }));
  });

  it('refuses payeeId together with merchantName, with the service not called', async () => {
    await expect(
      create.handler({ ...createArgs, payeeId: PAYEE_ID, merchantName: 'Starbucks' }, WRITE),
    ).rejects.toThrow(/payeeId.*merchantName/);
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it('says in its description that merchantName follows the promotion rules', () => {
    expect(create.config.description).toMatch(/merchantName/);
    expect(create.config.description).toMatch(/promotion/i);
  });
});

describe('update_transaction payee input', () => {
  const schema = update.config.inputSchema!;

  it('accepts a payeeId and null, and rejects a payeeId that is not an id', () => {
    expect(schema.safeParse({ id: ID, payeeId: PAYEE_ID }).success).toBe(true);
    expect(schema.safeParse({ id: ID, payeeId: null }).success).toBe(true);
    expect(schema.safeParse({ id: ID, payeeId: 'starbucks' }).success).toBe(false);
  });

  it('passes a payeeId to the service', async () => {
    await update.handler({ id: ID, payeeId: PAYEE_ID }, WRITE);

    expect(updateTransaction).toHaveBeenCalledWith(expect.objectContaining({ id: ID, payeeId: PAYEE_ID }));
  });

  it('passes null to the service so the payee is cleared', async () => {
    await update.handler({ id: ID, payeeId: null }, WRITE);

    expect(updateTransaction).toHaveBeenCalledWith(expect.objectContaining({ id: ID, payeeId: null }));
  });

  it('leaves the payee out of the service call when payeeId is not given', async () => {
    await update.handler({ id: ID, note: 'x' }, WRITE);

    expect(jest.mocked(updateTransaction).mock.calls[0]![0]).not.toHaveProperty('payeeId');
  });
});

describe('bulk_update_transactions payee input', () => {
  const schema = bulk.config.inputSchema!;

  it('accepts a payeeId and null, and rejects a payeeId that is not an id', () => {
    expect(schema.safeParse({ transactionIds: [ID], payeeId: PAYEE_ID }).success).toBe(true);
    expect(schema.safeParse({ transactionIds: [ID], payeeId: null }).success).toBe(true);
    expect(schema.safeParse({ transactionIds: [ID], payeeId: 'starbucks' }).success).toBe(false);
  });

  it('passes a payeeId and a null payeeId to the service', async () => {
    await bulk.handler({ transactionIds: [ID], payeeId: PAYEE_ID }, WRITE);
    await bulk.handler({ transactionIds: [ID], payeeId: null }, WRITE);

    expect(bulkUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({ payeeId: PAYEE_ID }));
    expect(bulkUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({ payeeId: null }));
  });
});

describe('MCP transaction tools forward paymentLegs', () => {
  let previousReadOnly: string | undefined;
  beforeEach(() => { previousReadOnly = process.env.MCP_READ_ONLY; process.env.MCP_READ_ONLY = 'false'; });
  afterEach(() => { if (previousReadOnly === undefined) delete process.env.MCP_READ_ONLY; else process.env.MCP_READ_ONLY = previousReadOnly; });
  beforeEach(() => {
    jest.mocked(createTransaction).mockRejectedValue(new Error('stop'));
    jest.mocked(updateTransaction).mockRejectedValue(new Error('stop'));
  });

  it.each([
    ['omitted', undefined, undefined],
    ['null', null, null],
    ['empty', [], []],
    ['a new part', [{ accountId: PAYEE_ID, amount: 5 }], [{ accountId: PAYEE_ID, amount: Money.fromDecimal(5) }]],
  ])('update_transaction forwards %s paymentLegs', async (_label, paymentLegs, expected) => {
    await update.handler({ id: ID, paymentLegs }, WRITE);
    expect(updateTransaction).toHaveBeenLastCalledWith(expect.objectContaining({ paymentLegs: expected }));
  });

  it('create_transaction forwards paymentLegs', async () => {
    await create.handler({ ...createArgs, paymentLegs: [{ transactionId: PAYEE_ID }] }, WRITE);
    expect(createTransaction).toHaveBeenLastCalledWith(
      expect.objectContaining({ paymentLegs: [{ transactionId: PAYEE_ID }] }),
    );
  });
});
