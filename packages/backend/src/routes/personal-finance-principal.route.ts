import { createController } from '@controllers/helpers/controller-factory';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import {
  correctPrincipalRecord,
  getPrincipalState,
  importPrincipalRecords,
  reconcileFinanceTransfers,
  savePrincipalTransferRule,
  recordPrincipalReview,
} from '@services/personal-finance/principal';
import { isRecordedDate, PRINCIPAL_AUTOMATION_START } from '@services/personal-finance/principal-matching';
import { Router } from 'express';
import { z } from 'zod';

const router = Router();
const id = z.string().uuid();
const date = z.string().refine(isRecordedDate, 'Use an actual YYYY-MM-DD date');
const amount = z
  .number()
  .finite()
  .min(-9_000_000_000_000)
  .max(9_000_000_000_000)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.0001, 'Use at most two decimal places');
const kind = z.enum(['employee', 'employer', 'unspecified']);
const record = z.object({
  accountId: id,
  date,
  amount,
  type: z.enum(['contribution', 'withdrawal', 'transfer', 'adjustment', 'interest', 'dividend']),
  toAccountId: id.nullable().optional(),
  opening: z.boolean().optional(),
  source: z.enum(['manual', 'google-sheets', 'bank-transfer', 'csv']),
  sourceId: z.string().min(1).max(500),
  sourceKey: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  note: z.string().max(10000).optional(),
  verified: z.boolean(),
  contributionKind: kind.optional(),
  transactionIds: z.array(id).max(5).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
});
router.get(
  '/',
  createController(z.object({}), async ({ user }) => ({ data: await getPrincipalState(user.id) })),
);
router.post(
  '/reviews',
  checkBaseCurrencyLock,
  createController(
    z.object({
      body: z.object({
        reviewKey: z.string().min(1).max(500),
        reason: z.string().min(1).max(2000),
        details: z.record(z.string(), z.unknown()),
      }),
    }),
    async ({ user, body }) => ({ data: await recordPrincipalReview(user.id, body) }),
  ),
);
router.post(
  '/import',
  checkBaseCurrencyLock,
  createController(
    z.object({ body: z.object({ records: z.array(record).min(1).max(3000) }) }),
    async ({ user, body }) => ({ data: await importPrincipalRecords(user.id, body.records) }),
  ),
);
router.post(
  '/corrections',
  checkBaseCurrencyLock,
  createController(
    z.object({
      body: z.object({
        cashFlowId: id,
        date,
        amount,
        description: z.string().max(10000).optional(),
        contributionKind: kind.optional(),
        principalValidThrough: date.nullable().optional(),
      }),
    }),
    async ({ user, body }) => ({ data: await correctPrincipalRecord(user.id, body) }),
  ),
);
router.post(
  '/transfer-rules',
  checkBaseCurrencyLock,
  createController(
    z.object({
      body: z.object({
        sourceNativeAccountId: id,
        destinationAccountId: id,
        exactDescription: z.string().trim().min(1).max(2000),
        effectiveFrom: date.default(PRINCIPAL_AUTOMATION_START),
        isEnabled: z.boolean().default(true),
      }),
    }),
    async ({ user, body }) => ({ data: await savePrincipalTransferRule(user.id, body) }),
  ),
);
router.post(
  '/reconcile',
  checkBaseCurrencyLock,
  createController(
    z.object({ body: z.object({ transactionIds: z.array(id).min(1).max(1000).optional() }) }),
    async ({ user, body }) => ({ data: await reconcileFinanceTransfers(user.id, body.transactionIds) }),
  ),
);
export default router;
