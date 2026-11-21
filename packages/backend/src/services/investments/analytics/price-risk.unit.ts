import { currentHoldingsPriceRisk } from './price-risk';

describe('available current-holdings price risk', () => {
  it('compares fixed quantities on genuine shared dates and exposes excluded coverage', () => {
    const holdings = [
      { id: 'a', symbol: 'A', quantity: '2', marketValue: '180', currencyCode: 'USD' },
      { id: 'b', symbol: 'B', quantity: '1', marketValue: '20', currencyCode: 'USD' },
    ];
    const points = [
      { securityId: 'a', date: '2026-11-17', price: '100' },
      { securityId: 'a', date: '2026-11-18', price: '110' },
      { securityId: 'a', date: '2026-11-20', price: '90' },
    ];
    const result = currentHoldingsPriceRisk(holdings as never, points, 'USD');
    expect(result.coveragePercent).toBe('90.000000');
    expect(result.excluded).toEqual(['B']);
    expect(result.points.map((p) => p.date)).toEqual(['2026-11-17', '2026-11-18', '2026-11-20']);
    expect(result.points[1]?.returnPercent).toBe('10.000000');
    expect(Number(result.maxDrawdown)).toBeCloseTo(-18.181818, 5);
    expect(result.volatility).toBeNull();
    expect(result.methodology).toContain('not historical account performance');
  });
});
