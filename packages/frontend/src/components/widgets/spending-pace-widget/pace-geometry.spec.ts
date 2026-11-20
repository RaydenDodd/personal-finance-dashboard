import { describe, it, expect } from 'vitest';

import { buildPaceGeometry } from './pace-geometry';
describe('shared native pace geometry', () => {
  it('retains the actual endpoint and separates forecast from actual', () => {
    const g = buildPaceGeometry({
      width: 300,
      height: 200,
      actual: [0, 100, null],
      comparison: [0, 80, 160],
      forecast: [null, 100, 200],
      todayIndex: 1,
      days: 3,
    })!;
    expect(g.todayDot?.x).toBe(150);
    expect(g.forecastDot?.x).toBe(300);
    expect(g.spentLine).not.toContain('300');
  });
  it('keeps withdrawals below zero and null history absent', () => {
    const g = buildPaceGeometry({
      width: 300,
      height: 200,
      actual: [null, 0, -100],
      comparison: [0, 50, 100],
      forecast: null,
      todayIndex: 2,
      days: 3,
    })!;
    expect(g.todayDot!.y).toBeGreaterThan(100);
    expect(g.spentLine).toMatch(/^M150/);
    expect(g.forecastLine).toBeNull();
  });
});
