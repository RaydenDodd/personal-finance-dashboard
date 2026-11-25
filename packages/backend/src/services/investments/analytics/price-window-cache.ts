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

/** Revision-keyed per-security cache. The caller supplies a revision for every
 * requested ID, including the truncate epoch. A bounded active set prevents
 * unbounded retention of old portfolio selections. */
export class InvestmentSecurityPriceCache<T extends PriceWindowRow & { securityId: string }> {
  private entries = new Map<string, { revision: string; from: number; through: number; rows: T[] }>();

  async read(revisions: ReadonlyMap<string, string>, now: number, load: (ids: string[], from: number, through: number) => Promise<T[]>) {
    const from = now - WINDOW_MS;
    const horizon = now + 10 * 60000;
    const missing: string[] = [];
    for (const id of this.entries.keys()) if (!revisions.has(id)) this.entries.delete(id);
    for (const [id, revision] of revisions) {
      const old = this.entries.get(id);
      if (!old || old.revision !== revision || old.from > from || old.through < now) {
        this.entries.delete(id);
        missing.push(id);
      }
    }
    if (missing.length) {
      const rows = await load(missing, from, horizon);
      const groups = Map.groupBy(rows, (row) => String(row.securityId));
      for (const id of missing) this.entries.set(id, { revision: revisions.get(id)!, from, through: horizon, rows: groups.get(id) ?? [] });
    }
    const rows: T[] = [];
    let retainedRows = 0;
    for (const entry of this.entries.values()) {
      retainedRows += entry.rows.length;
      for (const row of entry.rows) {
        const timestamp = +new Date(row.date);
        if (timestamp <= now && (!row.priceAsOf || timestamp % DAY_MS === 0 || timestamp >= from)) rows.push(row);
      }
    }
    // Preserve the existing global chronological order; same-timestamp rows
    // belong to distinct securities (unique security/date constraint).
    rows.sort((x, y) => +new Date(x.date) - +new Date(y.date));
    if (retainedRows > MAX_ROWS) this.entries.clear();
    return { rows, hit: missing.length === 0, loadedSecurities: missing.length, reusedSecurities: revisions.size - missing.length };
  }
}
