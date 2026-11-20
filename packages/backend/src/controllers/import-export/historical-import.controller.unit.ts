import { describe, expect, it, jest } from '@jest/globals';
import type { ZodType } from 'zod';

jest.mock('@controllers/helpers/controller-factory', () => ({
  createController: (schema: ZodType, handler: unknown) => ({ schema, handler }),
}));
jest.mock('@services/import-export/core/historical-transactions.service', () => ({
  previewHistoricalImport: jest.fn(),
  executeHistoricalImport: jest.fn(),
}));

import { executeHistoricalImportController, previewHistoricalImportController } from './historical-import.controller';

const previewSchema = (previewHistoricalImportController as unknown as { schema: ZodType }).schema;
const executeSchema = (executeHistoricalImportController as unknown as { schema: ZodType }).schema;
const row = () => ({
  accountId: '11111111-1111-4111-8111-111111111111',
  date: '2024-10-25',
  signedAmountCents: -1275,
  description: 'Historical grocery purchase',
  source: {
    key: 'purchase-1',
    fileName: 'bank.csv',
    fileHash: 'a'.repeat(64),
    sheet: 'CSV',
    row: 2,
    institution: 'Bank',
    transactionDate: '2024-10-25',
  },
});

describe('historical import request validation', () => {
  it('accepts an empty preview and a valid historical cash-flow record', () => {
    expect(previewSchema.safeParse({ body: { rows: [] } }).success).toBe(true);
    expect(previewSchema.safeParse({ body: { rows: [row()] } }).success).toBe(true);
  });

  it('rejects impossible calendar days and transaction/source date mismatches', () => {
    const valid = row();
    expect(
      previewSchema.safeParse({
        body: { rows: [{ ...valid, date: '2024-02-30', source: { ...valid.source, transactionDate: '2024-02-30' } }] },
      }).success,
    ).toBe(false);
    expect(previewSchema.safeParse({ body: { rows: [{ ...valid, date: '2024-10-26' }] } }).success).toBe(false);
  });

  it('requires exact integer cents and excludes zero-value notices', () => {
    for (const signedAmountCents of [0, 1.25, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(previewSchema.safeParse({ body: { rows: [{ ...row(), signedAmountCents }] } }).success).toBe(false);
    }
  });

  it('checks source hashes, source row identity, account UUIDs, and posting evidence', () => {
    const valid = row();
    for (const input of [
      { ...valid, accountId: 'unknown-account' },
      { ...valid, source: { ...valid.source, fileHash: 'not-a-hash' } },
      { ...valid, source: { ...valid.source, row: 0 } },
      { ...valid, postedDate: '2024-10-26' },
    ])
      expect(previewSchema.safeParse({ body: { rows: [input] } }).success).toBe(false);
  });

  it('does not accept expense refunds or simultaneous transfer and refund classifications', () => {
    expect(previewSchema.safeParse({ body: { rows: [{ ...row(), isRefund: true }] } }).success).toBe(false);
    expect(
      previewSchema.safeParse({
        body: { rows: [{ ...row(), signedAmountCents: 1275, isRefund: true, isTransfer: true }] },
      }).success,
    ).toBe(false);
  });

  it('requires a refund classification for refund targets and prevents two original targets', () => {
    const valid = row();
    expect(
      previewSchema.safeParse({ body: { rows: [{ ...valid, refundForSourceKey: 'old-purchase' }] } }).success,
    ).toBe(false);
    expect(
      previewSchema.safeParse({
        body: {
          rows: [
            {
              ...valid,
              signedAmountCents: 1275,
              isRefund: true,
              refundForTransactionId: valid.accountId,
              refundForSourceKey: 'old-purchase',
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      previewSchema.safeParse({
        body: { rows: [{ ...valid, signedAmountCents: 1275, isRefund: true, refundForSourceKey: 'old-purchase' }] },
      }).success,
    ).toBe(true);
  });

  it('requires the preview digest before any execute request reaches the service', () => {
    expect(executeSchema.safeParse({ body: { rows: [row()] } }).success).toBe(false);
    expect(executeSchema.safeParse({ body: { rows: [row()], previewToken: 'wrong' } }).success).toBe(false);
    expect(executeSchema.safeParse({ body: { rows: [row()], previewToken: 'a'.repeat(64) } }).success).toBe(true);
  });

  it('rejects oversized requests', () => {
    expect(previewSchema.safeParse({ body: { rows: Array.from({ length: 5001 }, row) } }).success).toBe(false);
  });
});
