export function stackedUpperBoundary(values: Record<string, number | null>, ids: string[], id: string): number | null {
  const value = values[id];
  if (typeof value !== 'number') return null;
  let positive = 0,
    negative = 0;
  for (const key of ids) {
    const current = values[key] ?? 0;
    if (key === id) return current < 0 ? negative : positive + current;
    if (current < 0) negative += current;
    else positive += current;
  }
  return null;
}

/** Keep the measured tooltip inside the chart and visible screen whenever it fits. */
export function chartTooltipPosition({
  anchor,
  container,
  tooltip,
  viewport,
}: {
  anchor: { x: number; y: number };
  container: { left: number; top: number; width: number; height: number };
  tooltip: { width: number; height: number };
  viewport: { width: number; height: number };
}) {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));
  const left = Math.max(4, 8 - container.left);
  const right = Math.min(container.width - tooltip.width - 4, viewport.width - container.left - tooltip.width - 8);
  const top = Math.max(4, 8 - container.top);
  const bottom = Math.min(container.height - tooltip.height - 4, viewport.height - container.top - tooltip.height - 8);
  return {
    x: clamp(anchor.x + 12, left, right),
    y: clamp(anchor.y - tooltip.height - 12, top, bottom),
  };
}
