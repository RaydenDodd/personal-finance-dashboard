import { describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';

import { nearestChartBucket, nearestChartPoint } from './chart-hit-testing';
import { stackedSegmentAt } from './stacked-chart';
import { useChartInteraction } from './use-chart-interaction';

describe('shared chart interactions', () => {
  it('uses Balance Trend snapping at both ends, midpoint and sparse dates', () => {
    const points = [10, 30, 100];
    expect([-20, 19, 21, 80, 200].map((x) => nearestChartPoint(points, x, (p) => p))).toEqual([10, 10, 30, 100, 100]);
    expect(nearestChartBucket([15, 45, 75], 44)).toBe(1);
    expect(nearestChartBucket([], 44)).toBe(-1);
  });
  it('hits the cursor segment, including negative adjustments and zero-height categories', () => {
    const segments = [
      { key: 'net', bounds: [0, 50] as const },
      { key: 'tax', bounds: [50, 70] as const },
      { key: 'empty', bounds: [70, 70] as const },
      { key: 'refund', bounds: [-10, 0] as const },
    ];
    expect(stackedSegmentAt(segments, 60)?.key).toBe('tax');
    expect(stackedSegmentAt(segments, -5)?.key).toBe('refund');
    expect(stackedSegmentAt(segments, 80)).toBeUndefined();
  });
  it('clears on outside taps, scroll, cancellation and Escape, but preserves a new inside selection', () => {
    const chart = document.createElement('div'),
      part = document.createElement('span'),
      other = document.createElement('div');
    chart.append(part);
    document.body.append(chart, other);
    const clear = vi.fn(),
      scope = effectScope();
    const api = scope.run(() => useChartInteraction({ containerRef: ref(chart), clear }))!;
    const pointer = (target: Element, type: string, x: number, y: number) => {
      const e = new Event(type, { bubbles: true });
      Object.assign(e, { pointerType: 'touch', clientX: x, clientY: y });
      target.dispatchEvent(e);
    };
    pointer(part, 'pointerdown', 10, 10);
    expect(clear).not.toHaveBeenCalled();
    pointer(part, 'pointermove', 11, 50);
    expect(clear).toHaveBeenCalled();
    expect(api.isScrolling()).toBe(true);
    pointer(part, 'pointerup', 11, 50);
    expect(api.isScrolling()).toBe(true);
    pointer(part, 'pointerdown', 10, 10);
    expect(api.isScrolling()).toBe(false);
    clear.mockClear();
    pointer(other, 'pointerdown', 1, 1);
    expect(clear).toHaveBeenCalledOnce();
    clear.mockClear();
    document.dispatchEvent(new Event('scroll'));
    expect(clear).toHaveBeenCalledOnce();
    clear.mockClear();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(clear).toHaveBeenCalledOnce();
    scope.stop();
    clear.mockClear();
    document.dispatchEvent(new Event('scroll'));
    expect(clear).not.toHaveBeenCalled();
    chart.remove();
    other.remove();
  });
});
