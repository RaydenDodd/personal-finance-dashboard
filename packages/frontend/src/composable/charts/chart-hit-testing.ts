import { bisector } from 'd3';

/** Balance Trend's nearest-date bisector, shared by continuous chart overlays. */
export function nearestChartPoint<T>(
  points: readonly T[],
  value: number,
  coordinate: (point: T) => number,
): T | undefined {
  if (!points.length) return undefined;
  const index = bisector<T, number>(coordinate).left(points, value, 1);
  const before = points[index - 1],
    after = points[index];
  return !before ? after : after && value - coordinate(before) > coordinate(after) - value ? after : before;
}

/** Use exact rendered bar centres, including band padding and capped bar widths. */
export function nearestChartBucket(centres: readonly number[], x: number): number {
  const point = nearestChartPoint(
    centres.map((cx, index) => ({ cx, index })),
    x,
    (p) => p.cx,
  );
  return point?.index ?? -1;
}
