import * as d3 from 'd3';
import { describe, expect, it } from 'vitest';

import { stackedUpperBoundary } from './chart-geometry';
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
