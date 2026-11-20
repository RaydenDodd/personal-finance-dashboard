/** Infer only from corroborating records in this same account, never from a ticker guess. */
export const publicSecurityTypeLookup = (records: { symbol: string | null; type: string | null }[]) => {
  const types = new Map<string, Set<string>>();
  for (const r of records)
    if (r.symbol && r.type) {
      const found = types.get(r.symbol) ?? new Set<string>();
      found.add(r.type);
      types.set(r.symbol, found);
    }
  return (symbol: string | null, explicit: string | null) => {
    if (explicit) return explicit;
    const found = symbol ? types.get(symbol) : undefined;
    return found?.size === 1 ? [...found][0]! : null;
  };
};
