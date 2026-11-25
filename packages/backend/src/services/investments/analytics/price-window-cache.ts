import { investmentPriceDate } from '@bt/shared/types/investment-market';

const DAY_MS = 86400000;
const WINDOW_MS = 7 * DAY_MS;
const REUSE_MS = 120000;
const MAX_ROWS = 200000;

/** Per-calculation memo, bounded by distinct instants rather than security rows. */
export function createPriceDateResolver(): typeof investmentPriceDate {
  const cache = new Map<string, string>();
  return (date, dateOnly) => {
    const timestamp = +new Date(date);
    const key = timestamp + ':' + String(dateOnly);
    const existing = cache.get(key);
    if (existing !== undefined) return existing;
    const result = investmentPriceDate(date, dateOnly);
    if (cache.size < 25000) cache.set(key, result);
    return result;
  };
}

type PriceWindowRow = { date: Date | string; priceAsOf?: Date | string | null };

/** Single worker-local, revision-keyed market-price dataset. Time bounds remain exact:
 * fetch a small future horizon but never return future rows; discard aged intraday
 * observations on each read. No account data or unbounded per-selection cache.
 */
export class InvestmentPriceWindowCache<T extends PriceWindowRow> {
  private entry?: { key: string; from: number; through: number; rows: T[] };

  async read(key: string | undefined, now: number, load: (from: number, through: number) => Promise<T[]>) {
    const from = now - WINDOW_MS;
    if (!key) return { rows: await load(from, now), hit: false };
    const existing = this.entry;
    const hit = !!existing && existing.key === key && existing.from <= from && now <= existing.through;
    let rows: T[];
    if (hit && existing) rows = existing.rows;
    else {
      // Release the previous dataset before loading another large result.
      this.entry = undefined;
      rows = await load(from, now + REUSE_MS);
      if (rows.length <= MAX_ROWS) this.entry = { key, from, through: now + REUSE_MS, rows };
    }
    return {
      hit,
      rows: rows.filter((row) => {
        const timestamp = +new Date(row.date);
        return timestamp <= now && (!row.priceAsOf || timestamp % DAY_MS === 0 || timestamp >= from);
      }),
    };
  }
}
