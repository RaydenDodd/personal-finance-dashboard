import { payrollRange, shiftPayrollRange } from '@/pages/income-management/payroll/date-range';
import { describe, expect, it } from 'vitest';

import { aggregateInvestmentFlows, chartNumber, withinRange } from './chart-model';
import { investmentRange, investmentRangeSettings } from './date-range';

describe('investment chart selection', () => {
  it('preserves a shifted annual range through parent settings persistence', () => {
    const current = payrollRange('1y', '2026-11-20', '2022-01-01');
    const shifted = shiftPayrollRange(current, -1, '2026-11-20');
    expect(shifted).toEqual({ preset: '1y', from: '2024-11-20', through: '2025-11-20' });
    expect(investmentRange(investmentRangeSettings(shifted), '2022-01-01')).toEqual(shifted);
  });
  it('retains a custom period and uses the actual history start for MAX', () => {
    expect(investmentRange({ dateRange: 'custom', from: '2024-01-01', through: '2024-06-30' }, '2022-01-01')).toEqual({
      preset: 'custom',
      from: '2024-01-01',
      through: '2024-06-30',
    });
    expect(investmentRange({ dateRange: 'MAX', from: '1900-01-01', through: '2024-06-30' }, '2022-06-15').from).toBe(
      '2022-06-15',
    );
  });
  it('keeps unknown financial observations null while retaining recorded zeroes', () => {
    expect(chartNumber(null)).toBeNull();
    expect(chartNumber('')).toBeNull();
    expect(chartNumber('invalid')).toBeNull();
    expect(chartNumber('0')).toBe(0);
    expect(chartNumber('0.00000001')).toBe(0.00000001);
  });
  it('includes actual range endpoints without replacing absent observations', () => {
    const points = [
      { date: '2024-01-01', value: null },
      { date: '2024-02-01', value: 0 },
      { date: '2024-03-01', value: 1 },
    ];
    expect(withinRange(points, '2024-01-01', '2024-02-01')).toEqual(points.slice(0, 2));
  });
  it('aggregates external flows independently of the selected date window with signed withdrawals', () => {
    const observations = [
      { date: '2024-01-05', contributions: '100.25', withdrawals: '0' },
      { date: '2024-01-25', contributions: '40.75', withdrawals: '25' },
      { date: '2024-02-01', contributions: '10', withdrawals: '0' },
      { date: '2024-04-01', contributions: '5', withdrawals: '2' },
    ];
    expect(aggregateInvestmentFlows(observations, 'monthly').map((row) => [row.date, row.values])).toEqual([
      ['2024-01-01', { contributions: 141, withdrawals: -25 }],
      ['2024-02-01', { contributions: 10, withdrawals: 0 }],
      ['2024-04-01', { contributions: 5, withdrawals: -2 }],
    ]);
    expect(aggregateInvestmentFlows(observations, 'quarterly').map((row) => [row.date, row.values])).toEqual([
      ['2024-01-01', { contributions: 151, withdrawals: -25 }],
      ['2024-04-01', { contributions: 5, withdrawals: -2 }],
    ]);
    expect(aggregateInvestmentFlows(observations, 'yearly')[0]?.values).toEqual({
      contributions: 156,
      withdrawals: -27,
    });
  });
  it('does not replace an unavailable flow with zero inside an aggregate', () => {
    expect(
      aggregateInvestmentFlows(
        [
          { date: '2024-01-05', contributions: null, withdrawals: '3' },
          { date: '2024-01-10', contributions: '10', withdrawals: '2' },
        ],
        'monthly',
      )[0]?.values,
    ).toEqual({ contributions: null, withdrawals: -5 });
  });
});
