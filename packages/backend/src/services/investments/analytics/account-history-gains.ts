import Big from 'big.js';

/** Work only from persisted account totals and external funding, never raw position histories. */
export function accountGainSeries(
  rows: { date: string; value: string | null; funding: string | null }[],
  from?: string,
) {
  const gains = rows.map((r) =>
    r.value == null || r.funding == null ? null : new Big(r.value).minus(r.funding).toString(),
  );
  // Use the last recorded closing observation BEFORE the interval, so the first day's change is included.
  let baseline: Big | null = null;
  for (let i = 0; i < rows.length; i++) {
    if (from && rows[i]!.date >= from) break;
    if (gains[i] != null) baseline = new Big(gains[i]!);
  }
  const periodGains = gains.map((gain, i) =>
    !from || rows[i]!.date < from || gain == null || baseline == null ? null : new Big(gain).minus(baseline).toString(),
  );
  return { gains, periodGains };
}

/** Missing accounts contribute no invented zero gain. The UI labels this recorded subtotal as partial. */
export function sumGainSeries(series: (string | null)[][], length: number) {
  return Array.from({ length }, (_, i) => {
    let total: Big | null = null;
    for (const values of series) {
      const value = values[i];
      if (value != null) total = (total ?? new Big(0)).plus(value);
    }
    return total?.toString() ?? null;
  });
}

/** Daily-valued Modified Dietz return. Dated flows are weighted to the end of their day;
 * this is an estimate of return, not an exact intraday time-weighted return.
 * Only supported valuation/funding observations contribute; never assume missing cash is zero.
 */
export function accountPeriodSeries(
  rows: { date: string; value: string | null; funding: string | null }[],
  from?: string,
) {
  let start = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.value == null || rows[i]!.funding == null) continue;
    if (from && rows[i]!.date < from) start = i;
    else {
      if (start < 0) start = i;
      break;
    }
  }
  const periodGains: (string | null)[] = rows.map(() => null);
  const periodCapital: (string | null)[] = rows.map(() => null);
  if (start < 0) return { periodGains, periodCapital, periodReturnPercent: rows.map(() => null) };
  const base = rows[start]!;
  const baseValue = new Big(base.value!),
    baseFunding = new Big(base.funding!);
  const time = Date.parse(base.date);
  let timingKnown = true;
  let previousFunding = baseFunding,
    weightedFlowTime = new Big(0);
  for (let i = start; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.funding == null) {
      timingKnown = false;
      continue;
    }
    const elapsed = (Date.parse(row.date) - time) / 86400000;
    const funding = new Big(row.funding);
    weightedFlowTime = weightedFlowTime.plus(funding.minus(previousFunding).times(elapsed));
    previousFunding = funding;
    if (row.value == null || (from && row.date < from)) continue;
    periodGains[i] = new Big(row.value).minus(baseValue).minus(funding.minus(baseFunding)).toString();
    if (!timingKnown) continue; // Dollar change is supported even when precise flow timing is not.
    periodCapital[i] = baseValue
      .plus(funding.minus(baseFunding))
      .minus(elapsed ? weightedFlowTime.div(elapsed) : 0)
      .toString();
  }
  return {
    periodGains,
    periodCapital,
    periodReturnPercent: periodGains.map((gain, i) =>
      gain != null && periodCapital[i] != null && new Big(periodCapital[i]!).gt(0)
        ? new Big(gain).div(periodCapital[i]!).times(100).toString()
        : null,
    ),
  };
}
