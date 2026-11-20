import type {
  InvestmentAllocation,
  InvestmentExposure,
  InvestmentExposureContribution,
  InvestmentFundOverlap,
  InvestmentFundSnapshot,
  InvestmentHolding,
  InvestmentMetric,
} from '@bt/shared/types/investment-analytics';
import Big from 'big.js';

export const sum = (values: (string | null | undefined)[]): string | null =>
  values.some((v) => v == null) ? null : values.reduce<Big>((n, v) => n.plus(v!), new Big(0)).toString();
export const percent = (part: string | null, whole: string | null): string | null =>
  part === null || whole === null || new Big(whole).lte(0) ? null : new Big(part).div(whole).times(100).toFixed(6);
export const metric = (value: string | null, reason?: string): InvestmentMetric => ({
  value,
  status: value === null ? 'unavailable' : 'verified',
  ...(reason && { reason }),
});

/** Strong aliases only. A ticker is display text, never an instrument identity. */
export function resolveFundIdentities(
  snapshots: InvestmentFundSnapshot[],
  securities: {
    id: string;
    isin?: string | null;
    cusip?: string | null;
    currencyCode: string;
    exchangeMic?: string | null;
    exchangeAcronym?: string | null;
  }[],
): InvestmentFundSnapshot[] {
  const normalized = (id: string) =>
    id
      .replace(/^(isin|cusip|uuid):/i, '')
      .trim()
      .toUpperCase();
  return snapshots.map((snapshot) => {
    const holdings = new Map<string, InvestmentFundSnapshot['holdings'][number]>();
    for (const holding of snapshot.holdings) {
      const strong = [holding.id, holding.isin, holding.cusip].filter((s): s is string => !!s).map(normalized);
      const matches = securities.filter(
        (s) =>
          [s.id, s.isin, s.cusip].some((v) => v && strong.includes(normalized(v))) &&
          (!holding.currencyCode || s.currencyCode === holding.currencyCode) &&
          (!holding.exchange || s.exchangeMic === holding.exchange || s.exchangeAcronym === holding.exchange),
      );
      const id = matches.length === 1 ? matches[0]!.id : holding.id;
      const row = { ...holding, id, ...(id !== holding.id && { sourceId: holding.id }) };
      const previous = holdings.get(id);
      if (previous) previous.weight = new Big(previous.weight).plus(row.weight).toString();
      else holdings.set(id, row);
    }
    return { ...snapshot, holdings: [...holdings.values()] };
  });
}

/** Boundary semantics match native investment contribution reporting, including selected subsets. */
export const externalFlow = (
  row: {
    fromPortfolioId: string | null;
    toPortfolioId: string | null;
    refAmount: string;
    refToAmount?: string | null;
    isAdjustment?: boolean;
  },
  selected: Set<string>,
): string => {
  if (row.isAdjustment) return '0';
  const from = row.fromPortfolioId !== null && selected.has(row.fromPortfolioId);
  const to = row.toPortfolioId !== null && selected.has(row.toPortfolioId);
  if (from === to) return '0';
  return to ? (row.refToAmount ?? row.refAmount) : new Big(row.refAmount).neg().toString();
};

/** Compose economic exposures without simultaneously counting fund wrappers. */
export function lookThrough(holdings: InvestmentHolding[], snapshots: InvestmentFundSnapshot[], total: string | null) {
  const byFund = new Map(snapshots.map((s) => [s.fundId, s]));
  const rows = new Map<string, InvestmentExposure>();
  const add = (
    id: string,
    symbol: string,
    name: string,
    value: Big,
    indirect: boolean,
    unknown: boolean,
    contribution: InvestmentExposureContribution,
    classification: Partial<InvestmentExposure>,
  ) => {
    const row = rows.get(id) ?? {
      id,
      symbol,
      name,
      directValue: '0',
      indirectValue: '0',
      totalValue: '0',
      weight: null,
      fundCount: 0,
      unknown,
      sourceDate: contribution.asOf,
      contributions: [],
      ...classification,
    };
    for (const key of [
      'sector',
      'industry',
      'country',
      'region',
      'market',
      'marketCap',
      'style',
      'assetClass',
    ] as const) {
      if (!row[key] && classification[key]) row[key] = classification[key];
      else if (row[key] && classification[key] && row[key] !== classification[key])
        row[key] = 'Unknown (conflicting classifications)';
    }
    row[indirect ? 'indirectValue' : 'directValue'] = new Big(row[indirect ? 'indirectValue' : 'directValue'])
      .plus(value)
      .toString();
    row.totalValue = new Big(row.totalValue).plus(value).toString();
    row.contributions.push({ ...contribution, value: value.toString() });
    if (row.sourceDate && contribution.asOf && contribution.asOf < row.sourceDate) row.sourceDate = contribution.asOf;
    rows.set(id, row);
  };
  const expand = (
    id: string,
    symbol: string,
    name: string,
    value: Big,
    path: Set<string>,
    c: InvestmentExposureContribution,
    classification: Partial<InvestmentExposure>,
    fund: boolean,
  ) => {
    const snapshot = byFund.get(id);
    if (!fund && !snapshot) {
      add(id, symbol, name, value, path.size > 0, false, c, classification);
      return;
    }
    if (!snapshot || path.has(id) || path.size >= 12) {
      add(
        `unknown:${id}`,
        'Unknown',
        `Unknown holdings · ${symbol}`,
        value,
        true,
        true,
        { ...c, fundId: c.fundId ?? id, fundSymbol: c.fundSymbol ?? symbol },
        {},
      );
      return;
    }
    const next = new Set(path).add(id);
    let covered = new Big(0);
    for (const holding of snapshot.holdings) {
      const weight = new Big(holding.weight);
      covered = covered.plus(weight);
      const classified = {
        ...holding,
        ...(holding.sector && {
          sector: `${snapshot.classificationStandard ?? 'Unspecified taxonomy'} · ${holding.sector}`,
        }),
        ...(holding.industry && {
          industry: `${snapshot.classificationStandard ?? 'Unspecified taxonomy'} · ${holding.industry}`,
        }),
      };
      expand(
        holding.id,
        holding.symbol,
        holding.name,
        value.times(weight).div(100),
        next,
        {
          ...c,
          fundId: c.fundId ?? id,
          fundSymbol: c.fundSymbol ?? symbol,
          weight: c.weight === null ? holding.weight : new Big(c.weight).times(holding.weight).div(100).toString(),
          source: snapshot.provider,
          asOf: c.fundId && c.asOf && c.asOf < snapshot.asOf ? c.asOf : snapshot.asOf,
        },
        classified,
        !!holding.isFund,
      );
    }
    if (covered.lt(100))
      add(
        `unknown:${id}`,
        'Unknown',
        `Unreported holdings · ${symbol}`,
        value.times(new Big(100).minus(covered)).div(100),
        true,
        true,
        {
          ...c,
          fundId: c.fundId ?? id,
          fundSymbol: c.fundSymbol ?? symbol,
          source: snapshot.provider,
          asOf: snapshot.asOf,
        },
        {},
      );
  };
  for (const h of holdings) {
    if (h.marketValue === null) continue;
    for (const account of h.accounts) {
      if (account.marketValue === null) continue;
      expand(
        h.id,
        h.symbol,
        h.name,
        new Big(account.marketValue),
        new Set(),
        {
          portfolioId: account.portfolioId,
          portfolioName: account.portfolioName,
          fundId: null,
          fundSymbol: null,
          value: account.marketValue,
          weight: null,
          source: account.source,
          asOf: account.updatedAt,
        },
        h,
        h.isFund,
      );
    }
  }
  return [...rows.values()]
    .map((row) => ({
      ...row,
      weight: percent(row.totalValue, total),
      fundCount: new Set(row.contributions.map((c) => c.fundId).filter(Boolean)).size,
    }))
    .sort((a, b) => new Big(b.totalValue).cmp(a.totalValue));
}

export function fundOverlap(
  snapshots: InvestmentFundSnapshot[],
  holdings: InvestmentHolding[],
): InvestmentFundOverlap[] {
  const result: InvestmentFundOverlap[] = [];
  const active = holdings.filter((h) => h.isFund);
  const byFund = new Map(snapshots.map((s) => [s.fundId, s]));
  for (let i = 0; i < active.length; i++)
    for (let j = i + 1; j < active.length; j++) {
      const left = active[i]!;
      const right = active[j]!;
      const a = byFund.get(left.id);
      const b = byFund.get(right.id);
      const flattened = (fund: InvestmentHolding) =>
        lookThrough(
          [
            {
              ...fund,
              marketValue: '100',
              accounts: [
                {
                  portfolioId: 'composition',
                  portfolioName: 'Fund composition',
                  quantity: '0',
                  costBasis: null,
                  averageCost: null,
                  marketValue: '100',
                  unrealizedGain: null,
                  source: 'Composition weights',
                  updatedAt: null,
                },
              ],
            },
          ],
          snapshots,
          '100',
        );
      const leftRows = a ? flattened(left).filter((r) => !r.unknown) : [];
      const rightRows = b ? flattened(right).filter((r) => !r.unknown) : [];
      const shared: InvestmentFundOverlap['shared'] = [];
      let overlap = new Big(0);
      for (const ah of leftRows) {
        const bh = rightRows.find((h) => h.id === ah.id);
        if (!bh) continue;
        overlap = overlap.plus(new Big(ah.totalValue).lt(bh.totalValue) ? ah.totalValue : bh.totalValue);
        shared.push({
          id: ah.id,
          symbol: ah.symbol,
          name: ah.name,
          leftWeight: ah.totalValue,
          rightWeight: bh.totalValue,
          combinedValue: new Big(left.marketValue ?? 0)
            .times(ah.totalValue)
            .plus(new Big(right.marketValue ?? 0).times(bh.totalValue))
            .div(100)
            .toString(),
        });
      }
      result.push({
        leftId: left.id,
        rightId: right.id,
        leftSymbol: left.symbol,
        rightSymbol: right.symbol,
        weightedOverlap: a && b ? overlap.toString() : null,
        sharedCount: shared.length,
        coverage:
          !a || !b
            ? 'unavailable'
            : new Big(sum(leftRows.map((r) => r.totalValue))!).lt(100) ||
                new Big(sum(rightRows.map((r) => r.totalValue))!).lt(100)
              ? 'partial'
              : 'verified',
        leftDate: a?.asOf ?? null,
        rightDate: b?.asOf ?? null,
        shared,
      });
    }
  return result;
}

export function allocation(
  rows: { key: string; label: string; value: string | null; id: string }[],
  total: string | null,
): InvestmentAllocation[] {
  const grouped = new Map<string, { label: string; value: Big; ids: Set<string> }>();
  for (const r of rows) {
    if (r.value === null) continue;
    const bucket = grouped.get(r.key) ?? { label: r.label, value: new Big(0), ids: new Set<string>() };
    bucket.value = bucket.value.plus(r.value);
    bucket.ids.add(r.id);
    grouped.set(r.key, bucket);
  }
  return [...grouped]
    .map(([key, b]) => ({
      key,
      label: b.label,
      value: b.value.toString(),
      percent: percent(b.value.toString(), total),
      securityIds: [...b.ids],
    }))
    .sort((a, b) => new Big(b.value).cmp(a.value));
}
