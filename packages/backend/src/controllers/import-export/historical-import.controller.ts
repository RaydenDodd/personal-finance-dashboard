import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import {
  executeHistoricalImport,
  previewHistoricalImport,
} from '@services/import-export/core/historical-transactions.service';
import { z } from 'zod';

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  });
const source = z.object({
  key: z.string().min(1).max(255),
  fileName: z.string().min(1).max(255),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/),
  sheet: z.string().min(1).max(255),
  row: z.number().int().positive(),
  institution: z.string().min(1).max(255),
  accountHint: z.string().max(100).optional(),
  bankId: z.string().min(1).max(255).optional(),
  category: z.string().max(255).optional(),
  transactionDate: day,
  postedDate: day.optional(),
  balanceCents: z.number().int().safe().optional(),
});
const row = z
  .object({
    accountId: recordId(),
    date: day,
    postedDate: day.optional(),
    signedAmountCents: z
      .number()
      .int()
      .safe()
      .refine((amount) => amount !== 0),
    description: z.string().min(1).max(1000),
    source,
    categoryId: recordId().optional(),
    mcc: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
    isTransfer: z.boolean().optional(),
    isRefund: z.boolean().optional(),
    refundForTransactionId: recordId().optional(),
    refundForSourceKey: z.string().min(1).max(255).optional(),
    reviewReason: z.string().min(1).max(255).optional(),
  })
  .refine((value) => value.date === value.source.transactionDate && value.postedDate === value.source.postedDate)
  .refine((value) => !value.isRefund || (value.signedAmountCents > 0 && !value.isTransfer))
  .refine((value) => !(value.refundForTransactionId && value.refundForSourceKey))
  .refine((value) => value.isRefund || !(value.refundForTransactionId || value.refundForSourceKey));
const requestBody = z.object({ rows: z.array(row).max(5000) });

export const previewHistoricalImportController = createController(
  z.object({ body: requestBody }),
  async ({ user, body }) => ({
    data: await previewHistoricalImport({ userId: user.id, rows: body.rows }),
  }),
);

export const executeHistoricalImportController = createController(
  z.object({
    body: requestBody.extend({ previewToken: z.string().regex(/^[a-f0-9]{64}$/) }),
  }),
  async ({ user, body }) => ({
    data: await executeHistoricalImport({ userId: user.id, ...body }),
  }),
);
