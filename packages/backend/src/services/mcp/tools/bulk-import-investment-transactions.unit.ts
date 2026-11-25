import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { createInvestmentTransaction } from '@services/investments/transactions/create.service';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';

import { bulkImportInvestmentTransactionsTool } from './bulk-import-investment-transactions';

jest.mock('@services/investments/transactions/create.service', () => ({ createInvestmentTransaction: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

const portfolioId = '11111111-1111-4111-8111-111111111111';
const securityId = '22222222-2222-4222-8222-222222222222';
const transactionId = '33333333-3333-4333-8333-333333333333';
const row = { securityId, category: 'buy', date: '2026-11-23', quantity: '0.25', price: '100', sourceRowId: 'a'.repeat(64) };
const second = { ...row, sourceRowId: 'b'.repeat(64) };
const write = makeExtra({ scopes: ['finance:read', 'finance:write', 'toolset:investments'] });
const tool = captureTools({ register: bulkImportInvestmentTransactionsTool })[0]!;
const create = jest.mocked(createInvestmentTransaction);
const lock = jest.mocked(isBaseCurrencyChangeLocked);
const oldReadOnly = process.env.MCP_READ_ONLY;

beforeEach(() => {
  jest.resetAllMocks();
  process.env.MCP_READ_ONLY = 'false';
  lock.mockResolvedValue(false);
  create.mockResolvedValue({ id: transactionId } as never);
});

afterEach(() => {
  if (oldReadOnly === undefined) delete process.env.MCP_READ_ONLY;
  else process.env.MCP_READ_ONLY = oldReadOnly;
});

describe('bulk_import_investment_transactions', () => {
  it('validates bounded rows and rejects missing or invalid source identities', () => {
    const schema = tool.config.inputSchema!;
    expect(schema.safeParse({ portfolioId, trades: [row] }).success).toBe(true);
    expect(schema.safeParse({ portfolioId, trades: [] }).success).toBe(false);
    expect(schema.safeParse({ portfolioId, trades: Array(51).fill(row) }).success).toBe(false);
    expect(schema.safeParse({ portfolioId, trades: [{ ...row, sourceRowId: 'bad' }] }).success).toBe(false);
    expect(schema.safeParse({ portfolioId, trades: [{ ...row, sourceRowId: undefined }] }).success).toBe(false);
    expect(schema.safeParse({ portfolioId, trades: [{ ...row, userId: 99 }] }).success).toBe(false);
  });

  it('validates the entire batch and repeated IDs before writing', async () => {
    await expect(tool.handler({ portfolioId, trades: [row, { ...second, settlementCurrencyCode: 'USD' }] }, write)).rejects.toThrow();
    await expect(tool.handler({ portfolioId, trades: [row, row] }, write)).rejects.toThrow(/unique/);
    expect(create).not.toHaveBeenCalled();
  });

  it('passes authenticated ownership and stable IDs to the canonical service', async () => {
    const args = { portfolioId, trades: [row, second] };
    const result = parseToolResult({ result: await tool.handler(args, write) });
    expect(create).toHaveBeenNthCalledWith(1, { userId: 42, portfolioId, ...row, fees: '0' });
    expect(create).toHaveBeenNthCalledWith(2, { userId: 42, portfolioId, ...second, fees: '0' });
    expect(result).toEqual({
      results: [
        { sourceRowId: row.sourceRowId, status: 'recorded_or_existing', transactionId },
        { sourceRowId: second.sourceRowId, status: 'recorded_or_existing', transactionId },
      ],
      remainingSourceRowIds: [],
    });
    await tool.handler(args, write);
    expect(create).toHaveBeenNthCalledWith(3, { userId: 42, portfolioId, ...row, fees: '0' });
  });

  it('stops on a failed row and reports remaining rows without applying them', async () => {
    create.mockRejectedValueOnce(new Error('not found'));
    const result = parseToolResult({ result: await tool.handler({ portfolioId, trades: [row, second] }, write) });
    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      results: [{ sourceRowId: row.sourceRowId, status: 'failed', message: expect.any(String) }],
      remainingSourceRowIds: [second.sourceRowId],
    });
  });

  it('rejects missing write scope, read-only users, a locked base currency and server read-only mode', async () => {
    const args = { portfolioId, trades: [row] };
    await expect(tool.handler(args, makeExtra({ scopes: ['finance:read', 'toolset:investments'] }))).rejects.toThrow(/finance:write/);
    await expect(tool.handler(args, makeExtra({ readOnly: true }))).rejects.toThrow(/editing/);
    lock.mockResolvedValue(true);
    await expect(tool.handler(args, write)).rejects.toThrow();
    process.env.MCP_READ_ONLY = 'true';
    await expect(tool.handler(args, write)).rejects.toThrow(/disabled/);
    expect(create).not.toHaveBeenCalled();
  });
});
