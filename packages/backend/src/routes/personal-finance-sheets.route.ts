import { createController } from '@controllers/helpers/controller-factory';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import {
  completeSheetsOAuth,
  configureSheetSync,
  getSheetSyncStatus,
  resolveSheetConflict,
  runSheetSync,
  startSheetsOAuth,
  storeSheetCredentials,
} from '@services/personal-finance/sheets-sync';
import { Router } from 'express';
import { z } from 'zod';

const router = Router();
router.use(authenticateSession);
const empty = z.object({});
router.get(
  '/',
  createController(empty, async ({ user }) => ({ data: await getSheetSyncStatus(user.id) })),
);
router.put(
  '/',
  checkBaseCurrencyLock,
  createController(
    z.object({
      body: z.object({
        enabled: z.boolean(),
        spreadsheetId: z.string().regex(/^[a-zA-Z0-9_-]{20,100}$/),
        sheetName: z.string().min(1).max(100),
        sheetId: z.number().int().min(0),
        mirrorSimplefin: z.boolean(),
        mappings: z
          .array(
            z.object({
              accountId: z.string().uuid(),
              balanceRow: z.number().int().min(4).max(19),
              principalRow: z
                .number()
                .int()
                .refine(
                  (row) => (row >= 49 && row <= 56) || (row >= 64 && row <= 66),
                  'Choose an existing principal account row',
                )
                .optional(),
            }),
          )
          .min(1)
          .max(16),
      }),
    }),
    async ({ user, body }) => ({ data: await configureSheetSync(user.id, body) }),
  ),
);
router.post(
  '/run',
  checkBaseCurrencyLock,
  createController(empty, async ({ user }) => ({ data: await runSheetSync(user.id) })),
);
router.post(
  '/credentials',
  checkBaseCurrencyLock,
  createController(
    z.object({
      body: z.object({
        kind: z.literal('service-account'),
        clientEmail: z.string().max(300),
        privateKey: z.string().min(100).max(20000),
      }),
    }),
    async ({ user, body }) => ({ data: await storeSheetCredentials(user.id, body) }),
  ),
);
router.get(
  '/oauth/start',
  createController(empty, async ({ user }) => ({ data: await startSheetsOAuth(user.id) })),
);
router.get(
  '/oauth/callback',
  createController(
    z.object({ query: z.object({ state: z.string().min(10).max(300), code: z.string().min(1).max(5000) }) }),
    async ({ user, query, res }) => {
      await completeSheetsOAuth(user.id, query.state, query.code);
      res.redirect('/personal-finance?googleSheets=connected');
    },
  ),
);
router.post(
  '/conflicts/:id/resolve',
  checkBaseCurrencyLock,
  createController(
    z.object({
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ resolution: z.enum(['sheet', 'dashboard']) }),
    }),
    async ({ user, params, body }) => ({ data: await resolveSheetConflict(user.id, params.id, body.resolution) }),
  ),
);
export default router;
