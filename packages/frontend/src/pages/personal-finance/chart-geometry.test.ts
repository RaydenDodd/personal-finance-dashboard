import * as d3 from 'd3';
import { describe, expect, it } from 'vitest';

import { chartTooltipPosition, stackedUpperBoundary } from './chart-geometry';
describe('stacked category hover coordinates', () => {
  it('follows the same upper boundary as the rendered diverging stack, while keeping raw tooltip amounts', () => {
    const rows = [
      { spendable: 50, savings: 200, investments: 100, retirement: 1000 },
      { spendable: -50, savings: 200, investments: -100, retirement: 1000 },
    ];
    const ids = ['spendable', 'savings', 'investments', 'retirement'];
    const stack = d3.stack<Record<string, number>>().keys(ids).offset(d3.stackOffsetDiverging)(rows);
    for (const layer of stack)
      for (const [i, point] of layer.entries()) expect(stackedUpperBoundary(rows[i]!, ids, layer.key)).toBe(point[1]);
    expect(stackedUpperBoundary(rows[0]!, ids, 'savings')).toBe(250);
    expect(rows[0]!.savings).toBe(200);
  });
  it('recalculates the boundary after filtering and leaves missing values absent', () => {
    expect(stackedUpperBoundary({ spendable: 50, savings: 200 }, ['savings'], 'savings')).toBe(200);
    expect(stackedUpperBoundary({ savings: null }, ['savings'], 'savings')).toBeNull();
  });
});

describe('touch chart tooltip bounds', () => {
  it('keeps the measured tooltip inside a narrow phone chart at both ends', () => {
    const container = { left: 24, top: 180, width: 272, height: 300 };
    for (const anchor of [
      { x: 0, y: 0 },
      { x: 272, y: 300 },
    ]) {
      const point = chartTooltipPosition({
        anchor,
        container,
        tooltip: { width: 264, height: 212 },
        viewport: { width: 320, height: 568 },
      });
      expect(point.x).toBeGreaterThanOrEqual(4);
      expect(point.x + 264).toBeLessThanOrEqual(container.width - 4);
      expect(point.y).toBeGreaterThanOrEqual(4);
      expect(point.y + 212).toBeLessThanOrEqual(container.height - 4);
    }
  });
  it('keeps the tooltip visible when the chart is partly above the screen', () => {
    const container = { left: 16, top: -70, width: 358, height: 300 };
    const point = chartTooltipPosition({
      anchor: { x: 355, y: 50 },
      container,
      tooltip: { width: 280, height: 150 },
      viewport: { width: 390, height: 844 },
    });
    expect(container.top + point.y).toBeGreaterThanOrEqual(8);
    expect(container.left + point.x + 280).toBeLessThanOrEqual(382);
  });
});
