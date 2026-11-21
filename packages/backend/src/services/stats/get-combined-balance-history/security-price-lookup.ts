import { Money } from '@common/types/money';
import SecurityPricing from '@models/investments/security-pricing.model';

import { formatDateKey } from './types';

// Loaded via raw SQL (no Money hydration), so priceClose is a raw DECIMAL
// string; Money is still allowed for hydrated callers (unit tests).
type SecurityPriceRow = Pick<SecurityPricing, 'securityId' | 'date'> & {
  priceClose: Money | string;
  unadjustedClose?: Money | string | null;
  source?: string | null;
  priceAsOf?: Date | string | null;
};

interface PriceLookup {
  /** Per-security ascending-date list, binary-searched by `createFindPriceForDate`. */
  pricesBySecurity: Map<string, Array<{ date: string; price: number }>>;
  /** Direct lookup keyed `${securityId}_${dateStr}` — last write wins on intraday collisions. */
  pricesBySecurityAndDate: Map<string, number>;
}

/**
 * Index prices by security and yyyy-MM-dd. `price.date` is TIMESTAMPTZ
 * (crypto carries intraday timestamps); formatting to `yyyy-MM-dd` collapses
 * same-day intraday rows onto a single daily bucket. Rows MUST be sorted
 * ascending by date so the per-security date list is ordered for the
 * binary-search fallback; last-write-wins on the exact-match map then picks the
 * latest intraday close for that day.
 */
export function createShareUnitFactor(
  rows: SecurityPriceRow[],
  dateKey: (date: Date | string, dateOnly?: boolean) => string = formatDateKey,
) {
  const maps = new Map<string, Map<string, number>>();
  const ordered = [...rows.filter((p) => !!p.priceAsOf), ...rows.filter((p) => !p.priceAsOf)];
  for (const p of ordered) {
    if (p.unadjustedClose == null || p.source !== 'yahoo') continue;
    const close = Money.isMoney(p.priceClose) ? p.priceClose.toNumber() : Number(p.priceClose);
    const raw = Money.isMoney(p.unadjustedClose) ? p.unadjustedClose.toNumber() : Number(p.unadjustedClose);
    if (close <= 0 || raw <= 0) continue;
    const map = maps.get(p.securityId) ?? new Map<string, number>();
    map.set(dateKey(p.priceAsOf ?? p.date, p.priceAsOf ? false : undefined), raw / close);
    maps.set(p.securityId, map);
  }
  const arrays = new Map([...maps].map(([id, map]) => [id, [...map].sort(([a], [b]) => a.localeCompare(b))]));
  return (id: string, day: string) => {
    const exact = maps.get(id)?.get(day);
    if (exact !== undefined) return exact;
    const entries = arrays.get(id);
    if (!entries) return 1;
    let lo = 0,
      hi = entries.length - 1,
      result = 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (entries[mid]![0] <= day) {
        result = entries[mid]![1];
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return result;
  };
}
export const buildPriceLookup = (
  rows: SecurityPriceRow[],
  dateKey: (date: Date | string, dateOnly?: boolean) => string = formatDateKey,
  currentShareUnits = false,
): PriceLookup => {
  const pricesBySecurity = new Map<string, Array<{ date: string; price: number }>>();
  const pricesBySecurityAndDate = new Map<string, number>();

  const rawDays = new Set(
    rows
      .filter((p) => p.unadjustedClose != null)
      .map((p) => `${p.securityId}_${dateKey(p.priceAsOf ?? p.date, p.priceAsOf ? false : undefined)}`),
  );
  const unitFactor = currentShareUnits ? createShareUnitFactor(rows, dateKey) : null;
  for (const price of rows) {
    const dateStr = dateKey(price.priceAsOf ?? price.date, price.priceAsOf ? false : undefined);
    if (price.unadjustedClose == null && price.source === 'yahoo' && rawDays.has(`${price.securityId}_${dateStr}`))
      continue;
    // Raw rows carry priceClose as a decimal string; hydrated callers pass Money.
    const value = price.unadjustedClose ?? price.priceClose;
    const rawValue = Money.isMoney(value) ? value.toNumber() : Number(value);
    const priceValue =
      currentShareUnits && price.unadjustedClose != null ? rawValue / unitFactor!(price.securityId, dateStr) : rawValue;

    if (!pricesBySecurity.has(price.securityId)) {
      pricesBySecurity.set(price.securityId, []);
    }
    pricesBySecurity.get(price.securityId)!.push({ date: dateStr, price: priceValue });
    pricesBySecurityAndDate.set(`${price.securityId}_${dateStr}`, priceValue);
  }

  return { pricesBySecurity, pricesBySecurityAndDate };
};

/**
 * Closure factory: returns the price for `securityId` on `targetDate`, falling
 * back to the latest known prior price (handles weekends, holidays, sparse
 * coverage). Returns `null` when no price is on or before the target date.
 */
export const createFindPriceForDate = ({ pricesBySecurity, pricesBySecurityAndDate }: PriceLookup) => {
  return (securityId: string, targetDate: string): number | null => {
    const exactPrice = pricesBySecurityAndDate.get(`${securityId}_${targetDate}`);
    if (exactPrice !== undefined) return exactPrice;

    const prices = pricesBySecurity.get(securityId);
    if (!prices || prices.length === 0) return null;

    // Ascending by date: binary-search the latest entry with `date <= targetDate`
    // (gap-day fallback for weekends/holidays/sparse coverage).
    let lo = 0;
    let hi = prices.length - 1;
    let lastValidPrice: number | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (prices[mid]!.date <= targetDate) {
        lastValidPrice = prices[mid]!.price;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return lastValidPrice;
  };
};
