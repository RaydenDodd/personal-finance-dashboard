import { Big } from 'big.js';
import { z } from 'zod';

const decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .max(70);
const positive = decimal.refine((v) => Number(v) >= 0 && Number.isFinite(Number(v)));
export const brokerSnapshotSchema = z
  .object({
    id: z.string().min(1).max(200),
    asOf: z.string().datetime(),
    source: z.string().min(1).max(300),
    currencyCode: z.literal('USD'),
    complete: z.boolean(),
    cash: decimal.nullable(),
    totalValue: positive.nullable(),
    positions: z
      .array(
        z.object({
          securityId: z.string().uuid(),
          symbol: z.string().min(1).max(50),
          quantity: positive,
          costBasis: positive.nullable(),
          reportedAverageCost: positive.optional(),
          // Position/basis exports establish shares without reporting a quote.
          marketValue: positive.nullable(),
          lastPrice: positive.optional(),
        }),
      )
      .max(500)
      .refine((ps) => new Set(ps.map((p) => p.securityId)).size === ps.length, 'Duplicate snapshot position'),
    lots: z.array(z.record(z.string(), z.unknown())).max(5000).default([]),
  })
  .superRefine((s, ctx) => {
    if (s.complete && s.cash !== null && s.totalValue !== null) {
      if (s.positions.some((p) => p.marketValue === null)) {
        ctx.addIssue({ code: 'custom', message: 'A reported account valuation requires every position value.' });
        return;
      }
      const sum = s.positions.reduce((n, p) => n.plus(p.marketValue!), new Big(s.cash));
      if (sum.minus(s.totalValue).abs().gt('0.02'))
        ctx.addIssue({ code: 'custom', message: 'Reported account total does not reconcile with positions and cash.' });
    }
  });
export const brokerDataSchema = z.object({
  broker: z.enum(['m1', 'robinhood', 'fidelity', 'public', 'vanguard']),
  accountKey: z.string().min(1).max(100),
  snapshots: z.array(brokerSnapshotSchema).max(500).default([]),
  documents: z
    .array(z.object({ name: z.string().max(300), sha256: z.string().regex(/^[a-f0-9]{64}$/) }))
    .max(200)
    .default([]),
  taxReports: z
    .array(
      z.object({
        year: z.number().int().min(2000).max(2100),
        source: z.string().max(300),
        dividends: decimal.nullable(),
        proceeds: decimal.nullable(),
        costBasis: decimal.nullable(),
        realizedGain: decimal.nullable(),
      }),
    )
    .max(100)
    .default([]),
  review: z.array(z.string().max(1000)).max(2000).default([]),
  historyComplete: z.boolean().default(false),
  sourceEvents: z.array(z.record(z.string(), z.unknown())).max(10000).default([]),
});
export type BrokerSnapshot = z.infer<typeof brokerSnapshotSchema>;
export type BrokerData = z.infer<typeof brokerDataSchema>;

export const latestSnapshot = (data: BrokerData | undefined, date?: Date): BrokerSnapshot | undefined =>
  data?.snapshots.filter((s) => !date || new Date(s.asOf) <= date).toSorted((a, b) => b.asOf.localeCompare(a.asOf))[0];
