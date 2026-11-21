import type { InvestmentHolding } from '@bt/shared/types/investment-analytics';

import { positionPeriodDates, positionPeriodReturns } from './position-performance';
describe('native position period attribution', () => {
  it('rejects unexplained share changes instead of calling them profits', () => {
    const result = positionPeriodReturns({
      holding: {
        securityId: 'PLTR',
        marketValue: '2000',
        accounts: [{ portfolioId: 'account', quantity: '20' }],
      } as InvestmentHolding,
      dates: { weekly: '2026-11-13' },
      openingValue: () => '1000',
      positionQuantity: () => '10',
      trades: [],
    });
    expect(result.weekly).toBeNull();
  });
  it('uses the selected historical closing value and excludes later trades', () => {
    const result = positionPeriodReturns({
      holding: { securityId: 'PLTR', marketValue: '1320', accounts: [{ portfolioId: 'account' }] } as InvestmentHolding,
      dates: { custom: '2026-11-13' },
      through: '2026-11-18',
      openingValue: (_p, _s, d) => (d === '2026-11-18' ? '1100' : '1000'),
      trades: [{ securityId: 'PLTR', portfolioId: 'account', date: '2026-11-19', category: 'buy', amount: '211' }],
    });
    expect(result.custom).toBe('10.000000');
  });
  const holding = {
    securityId: 'PLTR',
    marketValue: '1320',
    accounts: [{ portfolioId: 'account' }],
  } as InvestmentHolding;
  it('uses net recorded trade cash and distributions with the native opening valuation', () => {
    const gains: Record<string, string> = {};
    const result = positionPeriodReturns({
      holding,
      onGain: (period, gain) => {
        gains[period] = gain;
      },
      dates: positionPeriodDates('2026-11-20'),
      openingValue: () => '1000',
      trades: [
        { securityId: 'PLTR', portfolioId: 'account', date: '2026-11-19', category: 'buy', amount: '211' },
        { securityId: 'PLTR', portfolioId: 'account', date: '2026-11-19', category: 'dividend', amount: '2' },
      ],
    });
    expect(result.weekly).toBe('9.165979');
    expect(gains.weekly).toBe('111');
  });
  it('does not substitute security price appreciation when opening positions are absent', () => {
    const result = positionPeriodReturns({
      holding,
      dates: positionPeriodDates('2026-11-20'),
      openingValue: () => null,
      trades: [],
    });
    expect(result.weekly).toBeNull();
    expect(result['5y']).toBeNull();
  });
  it('clamps month-end and leap-day boundaries to supported calendar dates', () => {
    expect(positionPeriodDates('2024-03-31').monthly).toBe('2024-02-29');
    expect(positionPeriodDates('2024-02-29')['1y']).toBe('2023-02-28');
  });
});
