import { createController } from '@controllers/helpers/controller-factory';
import { fundCompositionRefreshCron } from '@crons/fund-composition-refresh';
import { ValidationError } from '@js/errors';
import { fundSnapshotSchema, saveFundSnapshots } from '@services/investments/analytics/fund-snapshots';
import { getInvestmentAnalytics } from '@services/investments/analytics/service';
import {
  getCompositionCatalog,
  getCompositionSchedule,
  inspectComposition,
  ownedCompositionSecurities,
  refreshSecComposition,
  saveCompositionSchedule,
} from '@services/investments/composition/service';
import { z } from 'zod';

const list = z
  .union([z.string().max(4000), z.array(z.string().max(100)).max(100)])
  .optional()
  .transform((v) => (Array.isArray(v) ? v : v?.split(','))?.map((s) => s.trim()).filter(Boolean));
export const getAnalytics = createController(
  z.object({
    query: z
      .object({
        portfolioIds: list,
        benchmarkSymbols: list,
        compact: z.enum(['true', 'false']).optional(),
        performanceFrom: z.iso.date().optional(),
        performanceThrough: z.iso.date().optional(),
      })
      .default({ portfolioIds: undefined, benchmarkSymbols: undefined }),
  }),
  async ({ user, query }) => ({
    data: await getInvestmentAnalytics({ userId: user.id, ...query, compact: query.compact === 'true' }),
  }),
);

export const getOverlapDetail = createController(
  z.object({ query: z.object({ portfolioIds: list, leftId: z.uuid(), rightId: z.uuid() }) }),
  async ({ user, query }) => {
    const result = await getInvestmentAnalytics({
      userId: user.id,
      portfolioIds: query.portfolioIds,
      benchmarkSymbols: [],
      compact: true,
      overlapPair: [query.leftId, query.rightId],
    });
    const pair = result.overlap.find(
      (p) =>
        (p.leftId === query.leftId && p.rightId === query.rightId) ||
        (p.leftId === query.rightId && p.rightId === query.leftId),
    );
    if (!pair)
      throw new ValidationError({ message: 'This fund pair is unavailable in the selected visible portfolios.' });
    return { data: pair };
  },
);

export const compositionCatalog = createController(z.object({}), async ({ user }) => ({
  data: await getCompositionCatalog(user.id),
}));
export const compositionFile = createController(
  z.object({
    body: z.object({
      fundId: z.uuid(),
      symbol: z.string().trim().min(1).max(30),
      adapter: z.enum([
        'sec-nport',
        'sec-gold-facts',
        'ishares-csv',
        'ssga-xlsx',
        'vanguard-file',
        'invesco-csv',
        'schwab-csv',
        'amplify-csv',
        'globalx-csv',
        'gld-xlsx',
        'spck-csv',
        'canonical-csv',
      ]),
      fileName: z.string().min(1).max(200),
      base64: z
        .string()
        .min(1)
        .max(16 * 1024 * 1024),
      sourceUrl: z.url().max(2000).optional(),
      asOf: z.iso.date().optional(),
      commit: z.boolean().default(false),
    }),
  }),
  async ({ user, body: { commit, ...input } }) => ({
    data: await inspectComposition({ userId: user.id, input, commit }),
  }),
);
export const compositionRefresh = createController(
  z.object({
    body: z.object({
      fundIds: z.array(z.uuid()).min(1).max(30),
      contact: z.email().max(200),
    }),
  }),
  async ({ user, body }) => ({ data: await refreshSecComposition({ userId: user.id, ...body }) }),
);
export const compositionSchedule = createController(
  z.object({ body: z.object({ enabled: z.boolean(), contact: z.email().max(200).optional() }) }),
  async ({ user, body }) => {
    const previous = await getCompositionSchedule(user.id);
    const contact = body.contact ?? previous?.contact ?? '';
    if (body.enabled && !contact)
      throw new ValidationError({ message: 'SEC scheduled refresh requires an identified contact email.' });
    const data = await saveCompositionSchedule(user.id, contact, body.enabled);
    if (body.enabled) {
      const timer = setTimeout(() => {
        void fundCompositionRefreshCron.triggerManualSync().catch(() => undefined);
      }, 2000);
      timer.unref();
    }
    return { data };
  },
);

export const importFundHoldings = createController(
  z.object({
    body: z.union([
      fundSnapshotSchema.transform((s) => ({ snapshots: [s] })),
      z.object({ snapshots: z.array(fundSnapshotSchema).min(1).max(20) }),
    ]),
  }),
  async ({ user, body }) => {
    const owned = await ownedCompositionSecurities(user.id);
    const reachable = new Set(owned.filter((f) => !f.identityConflict).map((f) => f.id as string));
    for (let depth = 0; depth < 12; depth++)
      for (const snapshot of body.snapshots.filter((s) => reachable.has(s.fundId)))
        for (const holding of snapshot.holdings.filter((h) => h.isFund)) reachable.add(holding.id);
    if (body.snapshots.some((s) => !reachable.has(s.fundId)))
      throw new ValidationError({
        message:
          'Each snapshot must reference an owned eligible fund, or a nested fund reachable from its composition.',
      });
    // Audited issuer provenance is created only by reparsing original bytes on the file endpoint.
    return {
      data: await saveFundSnapshots({
        userId: user.id,
        snapshots: body.snapshots.map(({ provenance: _provenance, ...s }) => s),
      }),
    };
  },
);
