import type { FundCompositionProvenance, InvestmentFundSnapshot } from '@bt/shared/types/investment-analytics';
import { ValidationError } from '@js/errors';
import { connection } from '@models/connection';
import InvestmentFundSnapshots from '@models/investments/fund-holdings-snapshot.model';
import { withTransaction } from '@services/common/with-transaction';
import Big from 'big.js';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { literal, Op } from 'sequelize';
import { z } from 'zod';

const text = z.string().trim().min(1).max(200);
const classification = z.string().trim().min(1).max(100).optional();
const weight = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .max(100)
  .refine((v) => new Big(v).abs().lte(1000));
const provenance = z.object({
  sourceId: text,
  sourceUrl: z.url().max(2000),
  fileName: text,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  parserVersion: text,
  method: z.enum(['issuer-file', 'sec-nport', 'sec-xbrl', 'manual']),
  rawSourceGzipBase64: z
    .string()
    .max(8 * 1024 * 1024)
    .optional(),
  reportedRowCount: z.number().int().min(0).max(10000),
  parsedRowCount: z.number().int().min(0).max(10000),
  unweightedRowCount: z.number().int().min(0).max(10000),
  completeness: z.enum(['full-file', 'partial']),
  warnings: z.array(z.string().max(1000)).max(10000),
  netWeight: weight,
  grossWeight: weight,
  residualWeight: weight,
  seriesId: text.optional(),
  classId: text.optional(),
  accession: text.optional(),
  fundNetAssets: z.string().max(100).optional(),
  autoRefreshPermitted: z.boolean(),
  refreshRunAt: z.iso.datetime().optional(),
}) satisfies z.ZodType<FundCompositionProvenance>;
export const fundSnapshotSchema = z
  .object({
    fundId: text,
    symbol: text,
    asOf: z.iso.date(),
    provider: text,
    retrievedAt: z.iso.datetime().optional(),
    classificationStandard: classification,
    provenance: provenance.optional(),
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
          notionalWeight: weight.optional(),
          marketValue: z.string().max(100).optional(),
          rawWeight: z.string().max(100).optional(),
          weightReported: z.boolean().optional(),
          issuerLei: classification,
          countryBasis: classification,
          classificationStandard: classification,
          classificationSource: text.optional(),
        }),
      )
      .min(1)
      .max(10000),
  })
  .superRefine((s, ctx) => {
    if (new Set(s.holdings.map((h) => h.id)).size !== s.holdings.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate underlying instrument identity.' });
    const net = s.holdings.reduce((n, h) => n.plus(h.weight), new Big(0));
    if (!s.provenance && (net.gt('100.000001') || s.holdings.some((h) => new Big(h.weight).lt(0))))
      ctx.addIssue({
        code: 'custom',
        message: 'Underlying weights exceed 100%; partial holdings must not be normalized.',
      });
    if (s.provenance && (!net.eq(s.provenance.netWeight) || !new Big(100).minus(net).eq(s.provenance.residualWeight)))
      ctx.addIssue({ code: 'custom', message: 'Source provenance and normalized composition do not reconcile.' });
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
        coverage: parsed.provenance
          ? new Big(100).minus(new Big(parsed.provenance.residualWeight).abs()).toString()
          : parsed.holdings.reduce((n, h) => n.plus(h.weight), new Big(0)).toString(),
      };
      const id = createHash('sha256')
        .update(JSON.stringify([userId, data.fundId, data.asOf, data.provider]))
        .digest('hex');
      await connection.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
        replacements: { key: `investment-fund-snapshot:${id}` },
      });
      const previous = await InvestmentFundSnapshots.findOne({ where: { id, userId } });
      if (previous) {
        if ('kind' in previous.data) throw new ValidationError({ message: 'Unexpected composition record identity.' });
        const stable = (s: InvestmentFundSnapshot) =>
          JSON.parse(
            JSON.stringify({
              ...s,
              retrievedAt: undefined,
              provenance: s.provenance ? { ...s.provenance, refreshRunAt: undefined, fileName: undefined } : undefined,
              holdings: s.holdings.toSorted((a, b) => a.id.localeCompare(b.id)),
            }),
          );
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
  (
    await InvestmentFundSnapshots.findAll({
      where: { userId, 'data.kind': { [Op.is]: null } },
      attributes: [[literal("data #- '{provenance,rawSourceGzipBase64}'"), 'data']],
    })
  )
    .map((r) => r.data)
    .filter((data): data is InvestmentFundSnapshot => !('kind' in data))
    .map((data) => ({
      ...data,
      provenance: data.provenance ? { ...data.provenance, rawSourceGzipBase64: undefined } : undefined,
    }));

export const latestFundSnapshots = (snapshots: InvestmentFundSnapshot[], asOf: string) => {
  const latest = new Map<string, InvestmentFundSnapshot>();
  for (const s of snapshots) {
    const previous = latest.get(s.fundId);
    const p = s.provenance,
      q = previous?.provenance;
    const parserOrder =
      p && q && p.sourceId === q.sourceId && p.sha256 === q.sha256
        ? p.parserVersion.localeCompare(q.parserVersion, 'en', { numeric: true })
        : 0;
    if (
      s.asOf <= asOf &&
      (!previous ||
        previous.asOf < s.asOf ||
        (previous.asOf === s.asOf &&
          (parserOrder > 0 || (parserOrder === 0 && new Big(s.coverage).gt(previous.coverage)))))
    )
      latest.set(s.fundId, s);
  }
  return [...latest.values()];
};
