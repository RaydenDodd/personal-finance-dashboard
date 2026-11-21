import Big from 'big.js';

import type { BrokerData } from '../broker-records/schema';

/** Cash-flow coverage is independent of trade, corporate-action or position coverage. */
export function verifiedFunding(
  data: BrokerData | undefined,
  rows: { date: string; amount: string; description: string }[],
  today: string,
) {
  const coverage = data?.fundingCoverage;
  if (
    !coverage ||
    coverage.through > today ||
    coverage.from > coverage.through ||
    !data.documents.some((d) => d.sha256 === coverage.documentSha256)
  )
    return false;
  const expected = new Set(coverage.sourceRowIds);
  if (rows.some((r) => r.date < coverage.from)) return false;
  if (expected.size !== coverage.sourceRowIds.length) return false;
  const covered = rows.filter((r) => r.date >= coverage.from && r.date <= coverage.through);
  const refs = covered.map((r) => /^\[broker-row:([a-f0-9]{64})\]/.exec(r.description)?.[1]);
  return (
    covered.length === expected.size &&
    new Set(refs).size === expected.size &&
    refs.every((r) => r && expected.has(r)) &&
    covered.reduce((n, r) => n.plus(r.amount), new Big(0)).eq(coverage.netContributions)
  );
}
