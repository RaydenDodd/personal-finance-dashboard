import Big from "big.js";

/** Work only from persisted account totals and external funding, never raw position histories. */
export function accountGainSeries(
  rows: { date: string; value: string | null; funding: string | null }[],
  from?: string,
) {
  const gains = rows.map((r) =>
    r.value == null || r.funding == null
      ? null
      : new Big(r.value).minus(r.funding).toString(),
  );
  // Use the last recorded closing observation BEFORE the interval, so the first day's change is included.
  let baseline: Big | null = null;
  for (let i = 0; i < rows.length; i++) {
    if (from && rows[i]!.date >= from) break;
    if (gains[i] != null) baseline = new Big(gains[i]!);
  }
  const periodGains = gains.map((gain, i) =>
    !from || rows[i]!.date < from || gain == null || baseline == null
      ? null
      : new Big(gain).minus(baseline).toString(),
  );
  return { gains, periodGains };
}

/** Missing accounts contribute no invented zero gain. The UI labels this recorded subtotal as partial. */
export function sumGainSeries(series: (string | null)[][], length: number) {
  return Array.from({ length }, (_, i) => {
    const known = series.map((s) => s[i]).filter((v): v is string => v != null);
    return known.length
      ? known.reduce((total, v) => total.plus(v), new Big(0)).toString()
      : null;
  });
}
