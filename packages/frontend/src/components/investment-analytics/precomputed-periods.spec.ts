import { describe, expect, it } from 'vitest';
import { usesCustomPositionPeriod } from './performers-model';

describe('precomputed holding period reuse', () => {
  it('reuses exact current monthly and yearly periods', () => {
    expect(usesCustomPositionPeriod({ from: '2026-10-25', through: '2026-11-25' }, 'monthly', '2026-11-25')).toBe(false);
    expect(usesCustomPositionPeriod({ from: '2025-11-25', through: '2026-11-25' }, '1y', '2026-11-25')).toBe(false);
  });
  it('preserves shifted and arbitrary dates', () => {
    expect(usesCustomPositionPeriod({ from: '2026-09-25', through: '2026-10-25' }, 'monthly', '2026-11-25')).toBe(true);
    expect(usesCustomPositionPeriod({ from: '2026-10-25', through: '2026-11-25' }, 'custom', '2026-11-25')).toBe(true);
  });
  it('matches the backend month-end clamp', () => {
    expect(usesCustomPositionPeriod({ from: '2026-02-28', through: '2026-03-31' }, 'monthly', '2026-03-31')).toBe(false);
  });
});
