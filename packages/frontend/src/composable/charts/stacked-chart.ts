/** Shared with Analytics → Net Worth History. Keep payroll bars on the native chart grammar. */
export const STACKED_CHART_STYLE = { padding: 0.2, maxBarWidth: 60, lineWidth: 2, dotRadius: 2.5, hoverRadius: 4 };
export function stackedSegmentAt<T extends { key: string; bounds: readonly [number, number] }>(
  segments: T[],
  value: number,
): T | undefined {
  return segments.find(({ bounds: [a, b] }) => a !== b && value >= Math.min(a, b) && value <= Math.max(a, b));
}
