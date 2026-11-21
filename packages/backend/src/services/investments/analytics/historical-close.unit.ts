import { originalShareClose, candleCloseTime } from '../data-providers/yahoo/historical-close';
import { uniquePriceObservations } from '../securities-price/pricing-anchor';

describe('published price representations', () => {
  it('retains one actual terminal quote and excludes extended-session bars', () => {
    const now = new Date('2026-11-21T07:00:00Z').getTime();
    const candle = candleCloseTime(new Date('2026-11-20T20:55:00Z'), true, now)!;
    const quote = candleCloseTime(new Date('2026-11-20T21:00:00Z'), true, now)!;
    expect(
      uniquePriceObservations([
        { date: candle, price: 342.68 },
        { date: quote, price: 343.6 },
      ]),
    ).toEqual([{ date: quote, price: 343.6 }]);
    expect(candleCloseTime(new Date('2026-11-20T23:00:00Z'), true, now)).toBeNull();
    expect(candleCloseTime(new Date('2026-11-20T14:00:00Z'), true, now)).toBeNull();
  });
  it('restores original-share closes using only subsequent published splits', () => {
    const splits = [{ date: new Date('2026-06-01T13:30:00Z'), numerator: 2, denominator: 1 }];
    expect(originalShareClose(50, new Date('2026-05-29T13:30:00Z'), splits)).toBe(100);
    expect(originalShareClose(50, new Date('2026-06-01T13:30:00Z'), splits)).toBe(50);
    expect(originalShareClose(50, new Date('2026-05-29T13:30:00Z'), [])).toBe(50);
  });
  it('does not timestamp an unfinished candle as a completed observation', () => {
    const start = new Date('2026-11-20T20:55:00Z');
    expect(candleCloseTime(start, true, new Date('2026-11-20T20:58:00Z').getTime())).toBeNull();
    expect(candleCloseTime(start, true, new Date('2026-11-20T21:01:00Z').getTime())!.toISOString()).toBe(
      '2026-11-20T21:00:00.000Z',
    );
  });
});
