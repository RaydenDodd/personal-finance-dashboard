import type { InvestmentFundSnapshot } from '@bt/shared/types/investment-analytics';
import { ValidationError } from '@js/errors';
import { connection } from '@models/connection';
import InvestmentFundSnapshots from '@models/investments/fund-holdings-snapshot.model';
import { withTransaction } from '@services/common/with-transaction';
import Big from 'big.js';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

const text = z.string().trim().min(1).max(200);
const classification = z.string().trim().min(1).max(100).optional();
const weight = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .max(30)
  .refine((v) => new Big(v).gte(0) && new Big(v).lte(100));
export const fundSnapshotSchema = z
  .object({
    fundId: text,
    symbol: text,
    asOf: z.iso.date(),
    provider: text,
    retrievedAt: z.iso.datetime().optional(),
    classificationStandard: classification,
    holdings: z
      .array(
        z.object({
          id: text,
          symbol: text,
          name: text,
          weight,
          isFund: z.boolean().optional(),
          sector: classification,
          industry: classification,
          country: classification,
          region: classification,
          market: classification,
          marketCap: classification,
          style: classification,
          assetClass: classification,
          isin: classification,
          cusip: classification,
          currencyCode: classification,
          exchange: classification,
        }),
      )
      .min(1)
      .max(10000),
  })
  .superRefine((s, ctx) => {
    if (new Set(s.holdings.map((h) => h.id)).size !== s.holdings.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate underlying instrument identity.' });
    if (s.holdings.reduce((n, h) => n.plus(h.weight), new Big(0)).gt('100.000001'))
      ctx.addIssue({
        code: 'custom',
        message: 'Underlying weights exceed 100%; partial holdings must not be normalized.',
      });
    if (s.asOf > new Date().toISOString().slice(0, 10))
      ctx.addIssue({ code: 'custom', message: 'Fund composition effective date cannot be in the future.' });
  });

export const saveFundSnapshots = withTransaction(
  async ({ userId, snapshots }: { userId: number; snapshots: z.infer<typeof fundSnapshotSchema>[] }) => {
    let inserted = 0;
    let duplicates = 0;
    for (const raw of snapshots) {
      const parsed = fundSnapshotSchema.parse(raw);
      const data: InvestmentFundSnapshot = {
        ...parsed,
        retrievedAt: parsed.retrievedAt ?? new Date().toISOString(),
        coverage: parsed.holdings.reduce((n, h) => n.plus(h.weight), new Big(0)).toString(),
      };
      const id = createHash('sha256')
        .update(JSON.stringify([userId, data.fundId, data.asOf, data.provider]))
        .digest('hex');
      await connection.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
        replacements: { key: `investment-fund-snapshot:${id}` },
      });
      const previous = await InvestmentFundSnapshots.findOne({ where: { id, userId } });
      if (previous) {
        const stable = (s: InvestmentFundSnapshot) => ({
          ...s,
          retrievedAt: undefined,
          holdings: s.holdings.toSorted((a, b) => a.id.localeCompare(b.id)),
        });
        if (!isDeepStrictEqual(stable(previous.data), stable(data)))
          throw new ValidationError({
            message:
              'This source/date composition is immutable. Use a distinct provider revision label for a correction.',
          });
        duplicates++;
        continue;
      }
      const [, created] = await InvestmentFundSnapshots.findOrCreate({ where: { id }, defaults: { id, userId, data } });
      if (created) inserted++;
      else duplicates++;
    }
    return { inserted, duplicates };
  },
);

export const getFundSnapshots = async (userId: number): Promise<InvestmentFundSnapshot[]> =>
  (await InvestmentFundSnapshots.findAll({ where: { userId } })).map((r) => r.data);

export const latestFundSnapshots = (snapshots: InvestmentFundSnapshot[], asOf: string) => {
  const latest = new Map<string, InvestmentFundSnapshot>();
  for (const s of snapshots)
    if (s.asOf <= asOf && (!latest.has(s.fundId) || latest.get(s.fundId)!.asOf < s.asOf)) latest.set(s.fundId, s);
  return [...latest.values()];
};
