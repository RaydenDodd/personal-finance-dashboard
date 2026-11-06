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
