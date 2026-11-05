import type { FinanceAccount, FinanceCashFlow, FinanceSnapshot, HistoryPoint } from './types';

/** Financial arithmetic is performed in integer cents, never floating point totals. */
export const cents = (value: number): number => {
  if (!Number.isFinite(value) || Math.abs(value) > 9_000_000_000_000) throw new Error('Invalid monetary amount');
  const result = Math.round(value * 100);
  if (Math.abs(value * 100 - result) > 0.0001) throw new Error('Use at most two decimal places');
  return result;
};
export const money = (value: number): number => value / 100;
export const sourceRank = (s: Pick<FinanceSnapshot, 'source' | 'verified'>): number =>
  (s.verified ? 100 : 0) + (s.source === 'manual' ? 40 : ['google-sheets', 'csv'].includes(s.source) ? 30 : 20);

/** Highest-quality valuation wins. A correction appends a revision, preserving its predecessor. */
export function preferredSnapshots(snapshots: FinanceSnapshot[]): FinanceSnapshot[] {
  const chosen = new Map<string, FinanceSnapshot>();
  for (const s of snapshots) {
    const key = `${s.accountId}:${s.date}`;
    const prior = chosen.get(key);
    if (!prior || sourceRank(s) > sourceRank(prior) ||
      (sourceRank(s) === sourceRank(prior) && (s.revision !== undefined && prior.revision !== undefined ?
        s.revision > prior.revision : `${s.createdAt}:${s.id}` > `${prior.createdAt}:${prior.id}`))) chosen.set(key, s);
  }
  return [...chosen.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function buildHistory(accounts: FinanceAccount[], snapshots: FinanceSnapshot[], granularity: 'monthly' | 'daily'): HistoryPoint[] {
  const included = accounts.filter((a) => a.included);
  const accountMap = new Map(included.map((a) => [a.id, a]));
  const buckets = new Map<string, FinanceSnapshot[]>();
  for (const s of preferredSnapshots(snapshots)) {
    if (!accountMap.has(s.accountId)) continue;
    const key = granularity === 'monthly' ? s.date.slice(0, 7) : s.date;
    buckets.set(key, [...(buckets.get(key) ?? []), s]);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, rows]) => {
    const latest = new Map<string, FinanceSnapshot>();
    for (const s of rows) if (!latest.has(s.accountId) || latest.get(s.accountId)!.date < s.date) latest.set(s.accountId, s);
    const balances: HistoryPoint['balances'] = {};
    const valuationDates: HistoryPoint['valuationDates'] = {};
    const categoryCents: Record<string, number> = {};
    const missingAccountIds: string[] = [];
    let totalCents = 0;
    for (const a of included) {
      const s = latest.get(a.id);
      balances[a.id] = s?.balance ?? null;
      valuationDates[a.id] = s?.date ?? null;
      // The extension deliberately aggregates a single currency. Foreign balances
      // remain visible as missing instead of silently adding incompatible units.
      if (!s || a.currencyCode !== 'USD') { missingAccountIds.push(a.id); continue; }
      const signed = a.balanceKind === 'liability' ? -Math.abs(cents(s.balance)) : cents(s.balance);
      totalCents += signed;
      categoryCents[a.categoryId] = (categoryCents[a.categoryId] ?? 0) + signed;
    }
    return {
      date: rows.map((r) => r.date).sort().at(-1)!, total: missingAccountIds.length ? null : money(totalCents),
      knownTotal: money(totalCents), complete: missingAccountIds.length === 0, missingAccountIds, balances, valuationDates,
      categories: Object.fromEntries(Object.entries(categoryCents).map(([key, val]) => [key, money(val)])),
    };
  });
}

export function principalFor(accountId: string, flows: FinanceCashFlow[], valuationDate: string) {
  const relevant = flows.filter((f) => f.date <= valuationDate && (f.accountId === accountId || f.toAccountId === accountId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const opening = relevant.find((f) => f.accountId === accountId && f.opening);
  let principalCents = 0, contributionsCents = 0, withdrawalsCents = 0, interestCents = 0, dividendsCents = 0;
  const basisFlows = opening ? relevant.slice(relevant.indexOf(opening)) : relevant;
  for (const f of basisFlows) {
    const amount = cents(f.amount);
    if (f.type === 'transfer') principalCents += f.accountId === accountId ? -amount : amount;
    else if (f.accountId === accountId) {
      if (f.type === 'contribution') { principalCents += amount; contributionsCents += amount; }
      if (f.type === 'withdrawal') { principalCents -= amount; withdrawalsCents += amount; }
      if (f.type === 'adjustment') principalCents += amount;
      if (f.type === 'interest') interestCents += amount;
      if (f.type === 'dividend') dividendsCents += amount;
    }
  }
  return {
    principal: opening ? money(principalCents) : null, principalComplete: Boolean(opening),
    contributions: money(contributionsCents), withdrawals: money(withdrawalsCents),
    interest: money(interestCents), dividends: money(dividendsCents),
  };
}

/** XIRR is shown only for an explicitly complete inception ledger spanning a year.
 * Multiple sign changes can produce ambiguous roots; these return unavailable. */
export function moneyWeightedReturn(accountId: string, flows: FinanceCashFlow[], terminalValue: number, terminalDate: string): number | null {
  const own = flows.filter((f) => f.date <= terminalDate && (f.accountId === accountId || f.toAccountId === accountId))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!own[0]?.opening || own[0].type !== 'contribution' || own[0].accountId !== accountId || own.some((f) => f.type === 'adjustment')) return null;
  const start = Date.parse(own[0].date);
  const elapsed = (Date.parse(terminalDate) - start) / 86400000;
  if (elapsed < 365 || terminalValue <= 0) return null;
  const series = own.flatMap((f) => {
    const incoming = f.type === 'contribution' || (f.type === 'transfer' && f.toAccountId === accountId);
    const outgoing = f.type === 'withdrawal' || (f.type === 'transfer' && f.accountId === accountId);
    return incoming || outgoing ? [{ years: (Date.parse(f.date) - start) / 86400000 / 365, value: f.amount * (incoming ? -1 : 1) }] : [];
  });
  series.push({ years: elapsed / 365, value: terminalValue });
  const signs = series.filter((p) => p.value !== 0).map((p) => Math.sign(p.value));
  if (signs.filter((s, i) => i > 0 && s !== signs[i - 1]).length !== 1) return null;
  const npv = (rate: number) => series.reduce((sum, p) => sum + p.value / Math.pow(1 + rate, p.years), 0);
  let low = -0.9999, high = 100;
  if (npv(low) * npv(high) >= 0) return null;
  for (let i = 0; i < 160; i++) { const mid = (low + high) / 2; if (npv(mid) > 0) low = mid; else high = mid; }
  return ((low + high) / 2) * 100;
}
