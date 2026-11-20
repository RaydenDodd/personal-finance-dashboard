import { describe, expect, it } from 'vitest';

import { payrollRange, shiftPayrollRange } from './date-range';

describe('independent payroll chart ranges', () => {
  it('keeps all time anchored to the earliest recorded salary', () =>
    expect(payrollRange('all', '2026-11-19', '2022-04-08')).toEqual({
      preset: 'all',
      from: '2022-04-08',
      through: '2026-11-19',
    }));
  it('shows one recent year then navigates by the selected interval', () => {
    const range = payrollRange('1y', '2026-11-19');
    expect(range.from).toBe('2025-11-19');
    const previous = shiftPayrollRange(range, -1, '2026-11-19');
    expect(previous).toEqual({ preset: '1y', from: '2024-11-19', through: '2025-11-19' });
    expect(shiftPayrollRange(previous, 1, '2026-11-19')).toEqual(range);
    expect(shiftPayrollRange(range, 1, '2026-11-19')).toBe(range);
  });
  it('moves month ranges by months rather than an average number of days', () => {
    const r = payrollRange('3m', '2026-11-19');
    expect(r.from).toBe('2026-08-19');
    expect(shiftPayrollRange(r, -1, '2026-11-19')).toEqual({ preset: '3m', from: '2026-05-19', through: '2026-08-19' });
  });
  it('keeps custom ranges contiguous and prevents unsupported future periods', () => {
    const r = { preset: 'custom' as const, from: '2026-05-01', through: '2026-05-31' };
    expect(shiftPayrollRange(r, -1, '2026-11-19')).toEqual({
      preset: 'custom',
      from: '2026-03-31',
      through: '2026-04-30',
    });
    expect(shiftPayrollRange({ preset: 'all', from: '2022-01-01', through: '2026-11-19' }, -1, '2026-11-19').from).toBe(
      '2022-01-01',
    );
  });
  it('uses current calendar YTD separately from salary rate ranges', () =>
    expect(payrollRange('ytd', '2026-11-19')).toEqual({ preset: 'ytd', from: '2026-01-01', through: '2026-11-19' }));
});
