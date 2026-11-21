import type {
  InvestmentAllocation,
  InvestmentExposure,
  InvestmentExposureContribution,
  InvestmentFundOverlap,
  InvestmentCategoryOverlap,
  InvestmentFundSnapshot,
  InvestmentHolding,
  InvestmentMetric,
} from '@bt/shared/types/investment-analytics';
import { bridgeCompositionIdentities } from '@services/investments/composition/identities';
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
export const isCompanyExposure = (row: Pick<InvestmentExposure, 'unknown' | 'assetClass'>) =>
  !row.unknown &&
  !/derivative|cash|money market|commodity|gold|fixed income|repurchase|liabilit|unclassified asset|collateral|crypto|other reported assets/i.test(
    row.assetClass ?? '',
  );

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
    symbol?: string | null;
    name?: string | null;
  }[],
): InvestmentFundSnapshot[] {
  snapshots = bridgeCompositionIdentities(snapshots, securities);
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
    classification = {
      ...classification,
      ...(/^(stocks?|equities|equity)$/i.test(classification.assetClass ?? '') && { assetClass: 'Equity' }),
      ...(classification.country && {
        country: issuerCountryLookup.get(classification.country.toUpperCase()) ?? classification.country,
      }),
    };
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
      if (isUnknownClassification(classification[key])) continue;
      if (!row[key] || (isUnknownClassification(row[key]) && !row[key]?.includes('conflicting')))
        row[key] = classification[key];
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
      if (holding.assetClass === 'Equity' && holding.weightReported === false) continue;
      const weight = new Big(holding.weight);
      covered = covered.plus(weight);
      const classified = {
        ...holding,
        ...(holding.sector && {
          sector: `${holding.classificationStandard ?? snapshot.classificationStandard ?? 'Unspecified taxonomy'} · ${holding.sector}`,
        }),
        ...(holding.industry && {
          industry: `${holding.classificationStandard ?? snapshot.classificationStandard ?? 'Unspecified taxonomy'} · ${holding.industry}`,
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
    if (!covered.eq(100))
      add(
        `unknown:${id}`,
        'Unknown',
        `${covered.gt(100) ? 'Unallocated net liabilities' : 'Unreported holdings / net assets'} · ${symbol}`,
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

const isUnknownClassification = (label: string | undefined): boolean =>
  !label?.trim() ||
  /^(unknown|unclassified|unspecified|unavailable|n\/?a|not available|not classified|none|undisclosed|unidentified|other)(\b|[ (])/i.test(
    label.trim(),
  ) ||
  /^[-?—–.]+$/.test(label.trim());
const countryAliases: Record<string, string> = {
  US: 'US',
  USA: 'US',
  'UNITED STATES': 'US',
  'UNITED STATES OF AMERICA': 'US',
  'U.S.': 'US',
  GB: 'GB',
  GBR: 'GB',
  UK: 'GB',
  'UNITED KINGDOM': 'GB',
  'GREAT BRITAIN': 'GB',
  CA: 'CA',
  CAN: 'CA',
  CANADA: 'CA',
};
const issuerCountryLookup = (() => {
  const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  const result = new Map<string, string | null>();
  const register = (label: string, code: string) => {
    const key = label.toUpperCase().replace(/\s+/g, ' ').trim();
    if (!result.has(key)) result.set(key, code);
    else if (result.get(key) !== code) result.set(key, null);
  };
  // Cache the platform's recognized two-letter territory/country catalog once.
  // Aggregate regions, unknown regions and pseudo locales are not issuer countries.
  const excluded = new Set(['EU', 'EZ', 'UN', 'ZZ', 'QO', 'XA', 'XB']);
  for (let first = 65; first <= 90; first++)
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second);
      if (excluded.has(code)) continue;
      // ICU canonical aliases identify deprecated codes; do not let historical
      // territories make a current English country name ambiguous.
      if (new Intl.Locale(`und-${code}`).region !== code) continue;
      const label = names.of(code);
      if (!label || label === code || /unknown region/i.test(label)) continue;
      register(code, code);
      register(label, code);
    }
  for (const [alias, code] of Object.entries(countryAliases)) register(alias, code);
  return result;
})();
export const investmentIssuerCountry = (label: string | undefined): string | null =>
  label ? (issuerCountryLookup.get(label.trim().toUpperCase()) ?? null) : null;

/** Compare only disclosed, mutually comparable classifications. Unknown is never a shared category. */
function categoryOverlap(
  leftRows: InvestmentExposure[],
  rightRows: InvestmentExposure[],
  mode: 'sector' | 'country',
  compositionsAvailable = true,
): InvestmentCategoryOverlap {
  if (!compositionsAvailable)
    return {
      weightedOverlap: null,
      status: 'unavailable',
      leftCoverage: '0',
      rightCoverage: '0',
      categories: [],
      reason: `A dated fund composition is missing for one or both funds; ${mode} overlap cannot be determined.`,
    };
  const classifications = (rows: InvestmentExposure[]) =>
    rows.flatMap((row) => {
      const original = row[mode]?.trim();
      if (row.unknown || isUnknownClassification(original)) return [];
      if (mode === 'country') {
        const upper = original!.toUpperCase().replace(/\s+/g, ' ');
        const country = issuerCountryLookup.get(upper);
        if (!country) return [];
        return [
          {
            key: country,
            label: country,
            taxonomy: 'issuer-country',
            weight: row.totalValue,
          },
        ];
      }
      // The shared look-through engine prefixes imported sector labels with their taxonomy.
      const separator = original!.indexOf(' · ');
      if (separator < 1) return [];
      const taxonomy = original!.slice(0, separator).trim().toUpperCase();
      const category = original!.slice(separator + 3).trim();
      if (isUnknownClassification(taxonomy) || isUnknownClassification(category)) return [];
      return [
        {
          key: `${taxonomy} · ${category.toLocaleLowerCase('en-US')}`,
          label: `${taxonomy} · ${category}`,
          taxonomy,
          weight: row.totalValue,
        },
      ];
    });
  const left = classifications(leftRows);
  const right = classifications(rightRows);
  const leftTaxonomies = new Set(left.map((row) => row.taxonomy));
  const rightTaxonomies = new Set(right.map((row) => row.taxonomy));
  const common = new Set([...leftTaxonomies].filter((taxonomy) => rightTaxonomies.has(taxonomy)));
  const comparableLeft = left.filter((row) => common.has(row.taxonomy));
  const comparableRight = right.filter((row) => common.has(row.taxonomy));
  const leftCoverage = sum(comparableLeft.map((row) => row.weight))!;
  const rightCoverage = sum(comparableRight.map((row) => row.weight))!;
  const buckets = new Map<string, { label: string; left: Big; right: Big }>();
  for (const [side, rows] of [
    ['left', comparableLeft],
    ['right', comparableRight],
  ] as const)
    for (const row of rows) {
      const bucket = buckets.get(row.key) ?? { label: row.label, left: new Big(0), right: new Big(0) };
      bucket[side] = bucket[side].plus(row.weight);
      buckets.set(row.key, bucket);
    }
  const categories = [...buckets.values()]
    .map((bucket) => ({
      label: bucket.label,
      leftWeight: bucket.left.toString(),
      rightWeight: bucket.right.toString(),
      overlapWeight: (bucket.left.lt(bucket.right) ? bucket.left : bucket.right).toString(),
    }))
    .toSorted((a, b) => new Big(b.overlapWeight).cmp(a.overlapWeight) || a.label.localeCompare(b.label));
  if (!common.size || new Big(leftCoverage).lte(0) || new Big(rightCoverage).lte(0))
    return {
      weightedOverlap: null,
      status: 'unavailable',
      leftCoverage,
      rightCoverage,
      categories,
      reason:
        mode === 'sector' && leftTaxonomies.size && rightTaxonomies.size && !common.size
          ? 'Sector taxonomies are incompatible; no normalization between standards has been verified.'
          : mode === 'country'
            ? 'Comparable issuer countries are unavailable; missing, unrecognized or ambiguous country labels remain unclassified.'
            : 'Comparable issuer sector classifications are unavailable for one or both reported fund compositions.',
    };
  const partial = new Big(leftCoverage).lt(100) || new Big(rightCoverage).lt(100);
  return {
    weightedOverlap: sum(categories.map((row) => row.overlapWeight)),
    status: partial ? 'partial' : 'verified',
    leftCoverage,
    rightCoverage,
    categories,
    ...(partial && {
      reason:
        'Known comparable classification weights only; unknown holdings and incompatible or unspecified taxonomies remain excluded.',
    }),
  };
}

export function fundOverlap(
  snapshots: InvestmentFundSnapshot[],
  holdings: InvestmentHolding[],
  options?: { includeDetails?: boolean; pair?: [string, string] },
): InvestmentFundOverlap[] {
  const result: InvestmentFundOverlap[] = [];
  const active = holdings.filter((h) => h.isFund);
  const byFund = new Map(snapshots.map((s) => [s.fundId, s]));
  // Normalize composition to 100 transient units once per fund. No positions,
  // account records or synthetic financial values are persisted by this calculation.
  const flattenedByFund = new Map(
    active.map((fund) => [
      fund.id,
      byFund.has(fund.id)
        ? lookThrough(
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
          ).filter(isCompanyExposure)
        : [],
    ]),
  );
  for (let i = 0; i < active.length; i++)
    for (let j = i + 1; j < active.length; j++) {
      const left = active[i]!;
      const right = active[j]!;
      const a = byFund.get(left.id);
      const b = byFund.get(right.id);
      const leftRows = flattenedByFund.get(left.id)!;
      const rightRows = flattenedByFund.get(right.id)!;
      const leftById = new Map(leftRows.map((row) => [row.id, row]));
      const rightById = new Map(rightRows.map((row) => [row.id, row]));
      const shared: InvestmentFundOverlap['shared'] = [];
      const includeDetails =
        options?.includeDetails !== false ||
        Boolean(options?.pair?.includes(left.id) && options?.pair?.includes(right.id));
      let sharedCount = 0;
      let overlap = new Big(0);
      for (const ah of leftRows) {
        const bh = rightById.get(ah.id);
        if (!bh) continue;
        overlap = overlap.plus(new Big(ah.totalValue).lt(bh.totalValue) ? ah.totalValue : bh.totalValue);
        sharedCount++;
        if (includeDetails)
          shared.push({
            id: ah.id,
            symbol: ah.symbol,
            name: ah.name,
            leftWeight: ah.totalValue,
            rightWeight: bh.totalValue,
            combinedValue:
              left.marketValue === null || right.marketValue === null
                ? null
                : new Big(left.marketValue)
                    .times(ah.totalValue)
                    .plus(new Big(right.marketValue).times(bh.totalValue))
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
        sharedCount,
        detailsLoaded: includeDetails,
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
        ...(!a || !b
          ? { reason: 'A dated fund composition is missing for one or both funds.' }
          : new Big(sum(leftRows.map((r) => r.totalValue))!).lt(100) ||
              new Big(sum(rightRows.map((r) => r.totalValue))!).lt(100)
            ? {
                reason:
                  'Known reported companies only. Unreported composition may add overlap or change which companies appear unique.',
              }
            : left.marketValue === null || right.marketValue === null
              ? { reason: 'Composition weights are known; dollar exposures require both fund position valuations.' }
              : {}),
        leftUnique:
          includeDetails && a && b
            ? leftRows
                .filter((row) => !rightById.has(row.id))
                .map((row) => ({
                  id: row.id,
                  symbol: row.symbol,
                  name: row.name,
                  weight: row.totalValue,
                  value:
                    left.marketValue === null
                      ? null
                      : new Big(left.marketValue).times(row.totalValue).div(100).toString(),
                }))
            : [],
        rightUnique:
          includeDetails && a && b
            ? rightRows
                .filter((row) => !leftById.has(row.id))
                .map((row) => ({
                  id: row.id,
                  symbol: row.symbol,
                  name: row.name,
                  weight: row.totalValue,
                  value:
                    right.marketValue === null
                      ? null
                      : new Big(right.marketValue).times(row.totalValue).div(100).toString(),
                }))
            : [],
        sectorOverlap: categoryOverlap(leftRows, rightRows, 'sector', !!a && !!b),
        countryOverlap: categoryOverlap(leftRows, rightRows, 'country', !!a && !!b),
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
