import { format, parseISO } from 'date-fns';
import { describe, expect, it } from 'vitest';

import {
  balanceTrendObservationTime,
  previousBalanceTrendPeriod,
  recordedBalanceTrendContext,
} from './balance-trend-history';

describe('recorded monthly balance trend', () => {
  it('compares September with all of August, retaining its first-day observation', () => {
    const result = previousBalanceTrendPeriod({ from: parseISO('2026-09-01'), to: parseISO('2026-09-30') });
    expect([format(result.from, 'yyyy-MM-dd'), format(result.to, 'yyyy-MM-dd')]).toEqual(['2026-08-01', '2026-08-31']);
  });
  it('retains a real earlier snapshot as context without adding daily balances', () => {
    const current = [{ date: '2026-10-01', value: 12500, historySource: 'imported' }];
    const earlier = [
      { date: '2026-08-01', value: 10000, historySource: 'imported' },
      { date: '2026-09-01', value: 11000, historySource: 'imported' },
    ];
    const result = recordedBalanceTrendContext(current, earlier);
    expect(result.points).toEqual([earlier[1], current[0]]);
    expect(current).toHaveLength(1);
    expect(result.baseline?.date).toBe('2026-09-01');
  });
  it('does not manufacture a baseline for the first observation or borrow live bank values', () => {
    const first = [{ date: '2022-06-15', historySource: 'imported' }];
    expect(recordedBalanceTrendContext(first, [])).toEqual({ points: first });
    expect(recordedBalanceTrendContext(first, [{ date: '2022-06-01', historySource: 'recorded' }])).toEqual({
      points: first,
    });
  });
  it('leaves daily bank series and multi-observation periods unchanged', () => {
    const daily = [{ date: '2026-11-05', historySource: 'recorded' }];
    expect(recordedBalanceTrendContext(daily, [{ date: '2026-11-01', historySource: 'imported' }])).toEqual({
      points: daily,
    });
    const multiple = [
      { date: '2026-10-01', historySource: 'imported' },
      { date: '2026-10-15', historySource: 'imported' },
    ];
    expect(recordedBalanceTrendContext(multiple, [])).toEqual({ points: multiple });
  });
  it('keeps the exact calendar date in browsers west of UTC', () => {
    const date = new Date(balanceTrendObservationTime('2026-10-01'));
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 9, 1]);
  });
});
