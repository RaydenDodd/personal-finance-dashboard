import { investmentPriceDate } from '@bt/shared/types/investment-market';
import { InvestmentPriceWindowCache, InvestmentSecurityPriceCache, createPriceDateResolver } from './price-window-cache';

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


it('reloads only changed securities, including deleted prices and a truncate epoch', async () => {
  const now = Date.parse('2026-11-25T20:00:00Z');
  const rows = [{ securityId: 'a', date: new Date('2026-11-24'), priceAsOf: null }, { securityId: 'b', date: new Date('2026-11-24'), priceAsOf: null }];
  const load = jest.fn(async (ids: string[], _from: number, _through: number) => rows.filter((row) => ids.includes(row.securityId)));
  const cache = new InvestmentSecurityPriceCache<(typeof rows)[number]>();
  expect((await cache.read(new Map([['a','0:0'],['b','0:0']]), now, load)).loadedSecurities).toBe(2);
  const warm = await cache.read(new Map([['a','0:0'],['b','0:0']]), now + 1000, load);
  expect(warm.hit).toBe(true);
  rows.splice(0, 1);
  const changed = await cache.read(new Map([['a','0:1'],['b','0:0']]), now + 2000, load);
  expect(changed.rows).toEqual(rows);
  expect(changed.loadedSecurities).toBe(1);
  expect(load.mock.calls[1]?.[0]).toEqual(['a']);
  expect((await cache.read(new Map([['a','1:1'],['b','1:0']]), now + 3000, load)).loadedSecurities).toBe(2);
});
