import { createController } from '@controllers/helpers/controller-factory';
import { fundSnapshotSchema, saveFundSnapshots } from '@services/investments/analytics/fund-snapshots';
import { getInvestmentAnalytics } from '@services/investments/analytics/service';
import { z } from 'zod';

const list = z
  .union([z.string().max(4000), z.array(z.string().max(100)).max(100)])
  .optional()
  .transform((v) => (Array.isArray(v) ? v : v?.split(','))?.map((s) => s.trim()).filter(Boolean));
export const getAnalytics = createController(
  z.object({
    query: z
      .object({ portfolioIds: list, benchmarkSymbols: list })
      .default({ portfolioIds: undefined, benchmarkSymbols: undefined }),
  }),
  async ({ user, query }) => ({ data: await getInvestmentAnalytics({ userId: user.id, ...query }) }),
);

export const importFundHoldings = createController(
  z.object({
    body: z.union([
      fundSnapshotSchema.transform((s) => ({ snapshots: [s] })),
      z.object({ snapshots: z.array(fundSnapshotSchema).min(1).max(20) }),
    ]),
  }),
  async ({ user, body }) => ({ data: await saveFundSnapshots({ userId: user.id, snapshots: body.snapshots }) }),
);
