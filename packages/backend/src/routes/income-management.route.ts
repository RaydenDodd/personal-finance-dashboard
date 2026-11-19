import { createController } from '@controllers/helpers/controller-factory';
import { ValidationError } from '@js/errors';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { extractTextFromFile } from '@services/import-export/statement-parser/text-extractor';
import { calculatePlan, getIncomeDashboard, importPaychecks, saveIncomeDocument } from '@services/income-management';
import { parseIncomeCsv, parsePaystubText } from '@services/income-management/import';
import { incomeDate, incomeDocumentSchema, incomePlanSchema, paycheckSchema } from '@services/income-management/schema';
import { getTaxData, refreshTaxSources } from '@services/income-management/tax-data';
import { Router } from 'express';
import { z } from 'zod';

const router = Router();
router.use(authenticateSession);
const dateNow = () => new Date().toISOString().slice(0, 10);
router.get(
  '/',
  createController(
    z.object({
      query: z
        .object({
          from: incomeDate.optional(),
          through: incomeDate.optional(),
          granularity: z.enum(['biweekly', 'monthly', 'yearly']).default('monthly'),
        })
        .refine((q) => !q.from || !q.through || q.from <= q.through, 'Start date must precede end date'),
    }),
    async ({ user, query }) => ({
      data: await getIncomeDashboard(
        user.id,
        query.from ?? dateNow().slice(0, 4) + '-01-01',
        query.through ?? dateNow(),
        query.granularity,
      ),
    }),
  ),
);
router.put(
  '/',
  checkBaseCurrencyLock,
  createController(z.object({ body: incomeDocumentSchema }), async ({ user, body }) => ({
    data: await saveIncomeDocument(user.id, body),
  })),
);
router.post(
  '/calculate',
  createController(z.object({ body: incomePlanSchema }), async ({ body }) => ({ data: calculatePlan(body) })),
);
router.post(
  '/import',
  checkBaseCurrencyLock,
  createController(
    z.object({
      body: z.object({
        records: z.array(paycheckSchema).min(1).max(10000),
        revision: z.number().int().min(0),
        previewOnly: z.boolean().default(true),
      }),
    }),
    async ({ user, body }) => ({ data: await importPaychecks(user.id, body.records, body.revision, body.previewOnly) }),
  ),
);
router.post(
  '/parse',
  createController(
    z.object({
      body: z.object({
        employerId: z.string().uuid(),
        type: z.enum(['csv', 'pdf']),
        content: z.string().max(8_000_000),
      }),
    }),
    async ({ body }) => {
      if (body.type === 'csv') return { data: { type: 'csv', ...parseIncomeCsv(body.content, body.employerId) } };
      const extracted = await extractTextFromFile({ buffer: Buffer.from(body.content, 'base64'), fileType: 'pdf' });
      if (!extracted.success || !extracted.text)
        throw new ValidationError({
          message: extracted.error ?? 'This PDF has no locally extractable text. Use manual entry or a CSV export.',
        });
      return { data: { type: 'pdf', ...parsePaystubText(extracted.text, body.employerId) } };
    },
  ),
);
router.get(
  '/tax-data',
  createController(z.object({}), async ({ user }) => ({ data: await getTaxData(user.id) })),
);
router.post(
  '/tax-data/refresh',
  createController(z.object({}), async ({ user }) => ({ data: await refreshTaxSources(user.id) })),
);
export default router;
