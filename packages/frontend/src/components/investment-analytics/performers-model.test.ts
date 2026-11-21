import type { InvestmentHolding } from '@bt/shared/types/investment-analytics';
import { describe, expect, it } from 'vitest';

import { rankInvestmentPerformers } from './performers-model';
const rows = [
  {
    id: 'one',
    securityId: 'one',
    symbol: 'SYNTH-A',
    name: 'Synthetic A',
    unrealizedPercent: '50',
    dailyChangePercent: '1',
    personalReturns: { weekly: '-3', monthly: '2', ytd: '8', '1y': '10' },
    priceDate: '2026-11-20',
  },
  {
    id: 'two',
    securityId: 'two',
    symbol: 'SYNTH-B',
    name: 'Synthetic B',
    unrealizedPercent: '10',
    dailyChangePercent: '2',
    personalReturns: { weekly: '4', monthly: '1', ytd: null, '1y': '-1' },
    priceDate: '2026-11-20',
  },
  {
    id: 'missing',
    securityId: 'missing',
    symbol: 'SYNTH-MISSING',
    name: 'Synthetic missing',
    unrealizedPercent: null,
    dailyChangePercent: null,
    personalReturns: { weekly: null, monthly: null, ytd: null, '1y': null },
    priceDate: null,
  },
] as unknown as InvestmentHolding[];
describe('investment performer period ranking', () => {
  it('defaults to remaining-position unrealized return and changes order for recorded weekly position gains', () => {
    expect(rankInvestmentPerformers(rows).map((row) => [row.symbol, row.returnValue])).toEqual([
      ['SYNTH-A', 50],
      ['SYNTH-B', 10],
    ]);
    expect(rankInvestmentPerformers(rows, 'weekly').map((row) => [row.symbol, row.returnValue])).toEqual([
      ['SYNTH-B', 4],
      ['SYNTH-A', -3],
    ]);
  });
  it('uses each exact supported period instead of substituting unrealized returns', () => {
    expect(rankInvestmentPerformers(rows, 'daily').map((row) => row.symbol)).toEqual(['SYNTH-B', 'SYNTH-A']);
    expect(rankInvestmentPerformers(rows, 'monthly').map((row) => row.returnValue)).toEqual([2, 1]);
    expect(rankInvestmentPerformers(rows, 'ytd').map((row) => row.returnValue)).toEqual([8]);
    expect(rankInvestmentPerformers(rows, '1y').map((row) => row.returnValue)).toEqual([10, -1]);
  });
  it('retains a recorded zero but excludes missing observations and respects the security filter', () => {
    const zero = { ...rows[0]!, personalReturns: { weekly: '0' } };
    expect(rankInvestmentPerformers([zero, rows[2]!], 'weekly')).toHaveLength(1);
    expect(rankInvestmentPerformers([zero, rows[2]!], 'weekly')[0]?.returnValue).toBe(0);
    expect(rankInvestmentPerformers(rows, 'weekly', 'two').map((row) => row.symbol)).toEqual(['SYNTH-B']);
  });
});
