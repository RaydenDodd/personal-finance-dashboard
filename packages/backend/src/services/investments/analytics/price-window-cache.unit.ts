import { investmentPriceDate } from '@bt/shared/types/investment-market';
import { InvestmentPriceWindowCache, createPriceDateResolver } from './price-window-cache';

describe('investment price window cache', () => {
  it('reuses only matching revision and selection, respects upper and lower time bounds', async () => {
    const now = Date.parse('2026-11-25T20:00:00Z');
    const rows = [
      { date: new Date(now - 7 * 86400000), priceAsOf: new Date(now - 7 * 86400000) },
      { date: new Date('2020-01-01T00:00:00Z'), priceAsOf: new Date('2020-01-01') },
      { date: new Date(now + 1000), priceAsOf: new Date(now + 1000) },
    ];
    const load = jest.fn(async (_from: number, _through: number) => rows);
    const cache = new InvestmentPriceWindowCache<(typeof rows)[number]>();
    expect(await cache.read('revision-a', now, load)).toEqual({ rows: rows.slice(0, 2), hit: false });
    expect(await cache.read('revision-a', now + 1000, load)).toEqual({ rows: rows.slice(1), hit: true });
    expect(load).toHaveBeenCalledTimes(1);
    expect((await cache.read('revision-b', now + 1000, load)).hit).toBe(false);
    expect((await cache.read('revision-b', now + 122000, load)).hit).toBe(false);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('keeps UTC daily bars and Eastern observations distinct', () => {
    const resolve = createPriceDateResolver();
    const value = new Date('2026-11-25T00:00:00Z');
    for (const mode of [undefined, false, true]) {
      expect(resolve(value, mode)).toBe(investmentPriceDate(value, mode));
      expect(resolve(value.toISOString(), mode)).toBe(investmentPriceDate(value, mode));
    }
  });
});
