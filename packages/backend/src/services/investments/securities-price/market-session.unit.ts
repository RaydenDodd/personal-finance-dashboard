import {
  easternDate,
  investmentPriceDate,
  usEquityMarketOpen,
  usEquitySession,
  previousUsEquitySession,
  usEquityCloseInstant,
} from '@bt/shared/types/investment-market';

describe('regular US market refresh window', () => {
  it.each([
    ['2026-11-20T14:29:59Z', false],
    ['2026-11-20T14:30:00Z', true],
    ['2026-11-20T20:59:59Z', true],
    ['2026-11-20T21:00:00Z', false],
    ['2026-06-22T13:30:00Z', true],
    ['2026-11-21T16:00:00Z', false],
    ['2026-11-26T16:00:00Z', false],
    ['2026-11-27T17:59:59Z', true],
    ['2026-11-27T18:00:00Z', false],
    ['2026-07-03T15:00:00Z', false],
    ['2026-04-03T15:00:00Z', false],
  ])('%s is open: %s', (value, expected) => expect(usEquityMarketOpen(new Date(value))).toBe(expected));
  it('retains daily bar dates while interpreting real quotes in Eastern time', () => {
    expect(easternDate(new Date('2026-11-21T01:00:00Z'))).toBe('2026-11-20');
    expect(investmentPriceDate('2026-11-20T00:00:00Z')).toBe('2026-11-20');
    expect(usEquitySession('2026-12-24').closeMinute).toBe(780);
    expect(usEquitySession('2027-03-26').tradingDay).toBe(false);
    expect(usEquitySession('2021-12-31').tradingDay).toBe(true);
  });
  it('dates official previous closes across weekends, holidays, DST and early closes', () => {
    expect(previousUsEquitySession('2026-11-30')).toBe('2026-11-27');
    expect(previousUsEquitySession('2026-11-27')).toBe('2026-11-25');
    expect(new Date(usEquityCloseInstant('2026-11-20')).toISOString()).toBe('2026-11-20T21:00:00.000Z');
    expect(new Date(usEquityCloseInstant('2026-06-22')).toISOString()).toBe('2026-06-22T20:00:00.000Z');
    expect(new Date(usEquityCloseInstant('2026-11-27')).toISOString()).toBe('2026-11-27T18:00:00.000Z');
  });
});
