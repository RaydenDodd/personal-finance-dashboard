import { createController } from '@controllers/helpers/controller-factory';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import * as finance from '@services/personal-finance';
import { configureBankHistory, getBankAccountHistory } from '@services/personal-finance/bank-history';
import { Router } from 'express';
import { z } from 'zod';

import principalRouter from './personal-finance-principal.route';
import personalFinanceSheetsRoutes from './personal-finance-sheets.route';

const router = Router();
router.use(authenticateSession);
router.use('/sheets-sync', personalFinanceSheetsRoutes);
router.use('/principal', principalRouter);
router.get(
  '/audit',
  createController(z.object({}), async ({ user }) => ({ data: await finance.getFinanceAudit(user.id) })),
);
router.get(
  '/snapshots/revisions',
  createController(z.object({}), async ({ user }) => ({ data: await finance.getFinanceRevisions(user.id) })),
);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Use an actual YYYY-MM-DD date',
  );
const amount = z
  .number()
  .finite()
  .min(-9_000_000_000_000)
  .max(9_000_000_000_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.0001, 'Use at most two decimal places');
const id = z.string().uuid();
const account = z.object({
  name: z.string().trim().min(1).max(200),
  currencyCode: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('USD'),
  categoryId: z.string().min(1).max(80),
  included: z.boolean().default(true),
  balanceKind: z.enum(['asset', 'liability']).default('asset'),
  nativeAccountId: id.nullable().default(null),
  preferredSource: z.enum(['manual', 'google-sheets', 'simplefin', 'plaid']).default('manual'),
  nativeAccountIds: z
    .array(id)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, 'Linked accounts must be unique')
    .optional(),
  description: z.string().max(2000).default(''),
});
const importBody = z.object({
  source: z.enum(['google-sheets', 'csv']).optional(),
  sourceId: z.string().min(1).max(500),
  previewToken: z.string().max(200).optional(),
  records: z
    .array(
      z.object({
        sourceKey: z.string().min(1).max(500),
        accountId: id,
        date,
        balance: amount,
        currencyCode: z.string().regex(/^[A-Z]{3}$/),
        sourceLabel: z.string().max(200).optional(),
        formula: z.string().max(10000).nullable().optional(),
        verified: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(20000),
});
router.get(
  '/bank-history/:id',
  createController(z.object({ params: z.object({ id }) }), async ({ user, params }) => ({
    data: await getBankAccountHistory(user.id, params.id),
  })),
);
router.post(
  '/bank-history/import',
  checkBaseCurrencyLock,
  createController(
    z.object({
      body: importBody.extend({
        mappings: z
          .array(
            z.object({
              id: z.string().min(1).max(100),
              label: z.string().min(1).max(200),
              sourceAccountIds: z.array(id).min(1).max(50),
              nativeAccountIds: z.array(id).max(50),
            }),
          )
          .min(1)
          .max(50),
      }),
    }),
    async ({ user, body }) => {
      const imported = await finance.commitFinanceImport(user.id, body);
      const configured = await configureBankHistory(user.id, body.mappings);
      return { data: { imported, ...configured } };
    },
  ),
);
router.get(
  '/dashboard',
  createController(
    z.object({
      query: z
        .object({
          from: date.optional(),
          to: date.optional(),
          granularity: z.enum(['monthly', 'daily']).default('monthly'),
          mode: z.enum(['all', 'personal']).default('all'),
        })
        .refine((q) => !q.from || !q.to || q.from <= q.to, 'Start date must precede end date'),
    }),
    async ({ user, query }) => ({ data: await finance.getFinanceDashboard(user.id, query) }),
  ),
);
router.put(
  '/categories',
  checkBaseCurrencyLock,
  createController(
    z.object({
      body: z.object({
        categories: z
          .array(
            z.object({
              id: z
                .string()
                .regex(/^[a-zA-Z0-9_-]+$/)
                .max(80),
              name: z.string().trim().min(1).max(100),
              color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
            }),
          )
          .min(1)
          .max(30),
      }),
    }),
    async ({ user, body }) => ({ data: await finance.updateFinanceCategories(user.id, body.categories) }),
  ),
);
router.post(
  '/accounts',
  checkBaseCurrencyLock,
  createController(z.object({ body: account }), async ({ user, body }) => ({
    data: await finance.saveFinanceAccount(user.id, body),
    statusCode: 201,
  })),
);
router.put(
  '/accounts/:id',
  checkBaseCurrencyLock,
  createController(z.object({ params: z.object({ id }), body: account.partial() }), async ({ user, params, body }) => ({
    data: await finance.saveFinanceAccount(user.id, body, params.id),
  })),
);
router.post(
  '/snapshots',
  checkBaseCurrencyLock,
  createController(
    z.object({
      body: z.object({
        accountId: id,
        date,
        balance: amount,
        source: z.literal('manual').optional(),
        verified: z.boolean().default(true),
        description: z.string().max(2000).optional(),
      }),
    }),
    async ({ user, body }) => ({ data: await finance.addFinanceSnapshot(user.id, body), statusCode: 201 }),
  ),
);
router.post(
  '/cash-flows',
  checkBaseCurrencyLock,
  createController(
    z.object({
      body: z.object({
        accountId: id,
        date,
        amount,
        type: z.enum(['contribution', 'withdrawal', 'transfer', 'adjustment', 'interest', 'dividend']),
        toAccountId: id.nullable().default(null),
        description: z.string().max(2000).default(''),
        opening: z.boolean().default(false),
        contributionKind: z.enum(['employee', 'employer', 'unspecified']).optional(),
        principalValidThrough: date.nullable().optional(),
        idempotencyKey: z.string().max(200).optional(),
      }),
    }),
    async ({ user, body }) => ({ data: await finance.addFinanceCashFlow(user.id, body), statusCode: 201 }),
  ),
);
router.post(
  '/import/preview',
  createController(z.object({ body: importBody }), async ({ user, body }) => ({
    data: await finance.previewFinanceImport(user.id, body),
  })),
);
router.post(
  '/import/commit',
  checkBaseCurrencyLock,
  createController(z.object({ body: importBody }), async ({ user, body }) => ({
    data: await finance.commitFinanceImport(user.id, body),
  })),
);
export default router;
