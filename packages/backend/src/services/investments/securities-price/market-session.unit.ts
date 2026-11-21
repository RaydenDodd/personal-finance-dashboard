import {
  easternDate,
  investmentPriceDate,
  usEquityMarketOpen,
  usEquitySession,
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
});
