import { createController } from '@controllers/helpers/controller-factory';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import {
  getPayrollDashboard,
  importPayroll,
  importReviewedPayroll,
  parsePayrollPdf,
  linkPayrollDeposits,
  savePayrollManagement,
  updatePayrollReminder,
} from '@services/income-management/payroll';
import { reconcilePayrollPrincipal } from '@services/income-management/payroll-principal';
import {
  payrollImportSchema,
  payrollManagementSchema,
  payrollQuerySchema,
} from '@services/income-management/payroll-schema';
import { paycheckSchema } from '@services/income-management/schema';
import { Router } from 'express';
import { z } from 'zod';

const router = Router();
router.use(authenticateSession);
router.get(
  '/',
  createController(z.object({ query: payrollQuerySchema }), async ({ user, query }) => ({
    data: await getPayrollDashboard(user.id, query),
  })),
);
router.post(
  '/import',
  checkBaseCurrencyLock,
  createController(z.object({ body: payrollImportSchema }), async ({ user, body }) => ({
    data: await importPayroll(user.id, body),
  })),
);
router.post(
  '/parse-pdf',
  createController(
    z.object({ body: z.object({ employmentId: z.string().uuid(), content: z.string().max(8_000_000) }) }),
    async ({ user, body }) => ({ data: await parsePayrollPdf(user.id, body.employmentId, body.content) }),
  ),
);
router.post(
  '/manual',
  checkBaseCurrencyLock,
  createController(
    z.object({
      body: z.object({
        employmentId: z.string().uuid(),
        revision: z.number().int().min(0),
        record: paycheckSchema,
        documentHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
        previewOnly: z.boolean().default(true),
        reviewConfirmed: z.literal(true),
      }),
    }),
    async ({ user, body }) => ({ data: await importReviewedPayroll(user.id, body) }),
  ),
);
router.put(
  '/management',
  checkBaseCurrencyLock,
  createController(z.object({ body: payrollManagementSchema }), async ({ user, body }) => ({
    data: await savePayrollManagement(user.id, body),
  })),
);
router.post(
  '/link',
  checkBaseCurrencyLock,
  createController(
    z.object({
      body: z.object({
        revision: z.number().int().min(0),
        statementId: z.string().uuid(),
        depositIds: z.array(z.string()).max(20),
      }),
    }),
    async ({ user, body }) => ({ data: await linkPayrollDeposits(user.id, body) }),
  ),
);
router.post(
  '/reminder',
  createController(z.object({ body: z.object({ action: z.enum(['snooze', 'dismiss']) }) }), async ({ user, body }) => ({
    data: await updatePayrollReminder(user.id, body.action),
  })),
);
router.post(
  '/retirement/reconcile',
  checkBaseCurrencyLock,
  createController(
    z.object({
      body: z.object({
        employmentId: z.string().uuid(),
        accountId: z.string().uuid(),
        previewOnly: z.boolean().default(true),
        previewToken: z.string().max(200).optional(),
      }),
    }),
    async ({ user, body }) => ({ data: await reconcilePayrollPrincipal(user.id, body) }),
  ),
);
export default router;
