import { INVESTMENT_PERFORMER_PERIODS } from '@/components/investment-analytics/performers-model';

import type { WidgetDefinition } from './widget-registry';

/** The same panel kinds are used on Investments pages and the main Dashboard. */
export const INVESTMENT_WIDGETS = [
  ['overview', 'Investment Overview', 'Market value, investment gains, invested capital and return availability.'],
  ['performance', 'Portfolio Performance', 'Recorded investment performance with configurable periods and series.'],
  [
    'value-capital',
    'Value vs. Invested Capital',
    'Historical market value, net invested capital and investment gains.',
  ],
  ['benchmark', 'Benchmark Comparison', 'Comparable normalized performance and benchmark coverage.'],
  ['allocation', 'Investment Allocation', 'Direct holdings, underlying companies and thirteen allocation modes.'],
  ['heatmap', 'Portfolio Heatmap / Treemap', 'Explore your investments by size, performance, grouping and exposure.'],
  ['holdings', 'Combined Holdings', 'Consolidated positions, weighted cost basis and account drill-down.'],
  ['exposure', 'Underlying Company Exposure', 'Direct and indirect company exposure with fund provenance.'],
  ['sector', 'Sector Allocation', 'Look-through sector exposure with amounts and percentages.'],
  ['geography', 'Geographical Allocation', 'Issuer-country, region and international exposure with coverage.'],
  ['dividends', 'Dividend Income', 'Recorded dividends and interest by month, quarter or year.'],
  ['dividend-calendar', 'Dividend Calendar', 'Recorded, announced and estimated investment distributions.'],
  ['performers', 'Best & Worst Performers', 'Security or portfolio performance, with unavailable periods identified.'],
  ['concentration', 'Portfolio Concentration', 'Largest holdings, top-five and top-ten exposure and concentration.'],
  ['gains', 'Realized & Unrealized Gains', 'Investment gains and losses, separate from deposits and withdrawals.'],
  ['overlap', 'ETF Overlap', 'Pairwise weighted fund overlap and shared underlying companies.'],
  ['contributions', 'Investment Contributions', 'External contributions, withdrawals and investment funding trends.'],
  ['risk', 'Risk & Drawdown', 'Drawdown, volatility and historical risk coverage.'],
  ['portfolio-comparison', 'Portfolio Comparison', 'Individual portfolio values and comparable performance history.'],
  ['health', 'Market Data Health', 'Price freshness, missing basis, fund coverage and reconciliation status.'],
] as const;

export type InvestmentWidgetKind = (typeof INVESTMENT_WIDGETS)[number][0];

export const INVESTMENT_WIDGET_DEFINITIONS: Record<string, WidgetDefinition> = Object.fromEntries(
  INVESTMENT_WIDGETS.map(([kind, name, description]) => {
    const id = `investment-${kind}`;
    return [
      id,
      {
        id,
        name,
        description,
        literalLabels: true,
        allowMultiple: true,
        defaultColSpan: ['performance', 'value-capital', 'benchmark', 'holdings', 'portfolio-comparison'].includes(kind)
          ? 2
          : 1,
        defaultRowSpan: 1,
        allowedSizes: [
          { colSpan: 1, rowSpan: 1, label: '1×1' },
          { colSpan: 2, rowSpan: 1, label: '2×1' },
          { colSpan: 3, rowSpan: 1, label: '3×1' },
          { colSpan: 2, rowSpan: 2, label: '2×2' },
          { colSpan: 3, rowSpan: 2, label: '3×2' },
        ],
        needsPeriod: false,
        component: () => import('./investment-widget.vue'),
      } satisfies WidgetDefinition,
    ];
  }),
);

export const investmentWidgetKind = (id: string): InvestmentWidgetKind | null =>
  INVESTMENT_WIDGETS.find(([kind]) => id === `investment-${kind}`)?.[0] ?? null;

export const INVESTMENT_DATE_RANGES = ['1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y', 'MAX', 'custom'] as const;

export const INVESTMENT_ALLOCATION_MODES = [
  ['holdings', 'Direct holdings'],
  ['underlying', 'Underlying companies'],
  ['sector', 'Sector'],
  ['industry', 'Industry'],
  ['assetClass', 'Asset class'],
  ['brokerage', 'Brokerage'],
  ['accountType', 'Account type'],
  ['country', 'Issuer country'],
  ['region', 'Region'],
  ['usInternational', 'US / international'],
  ['development', 'Developed / emerging'],
  ['marketCap', 'Market capitalization'],
  ['style', 'Growth / value / blend'],
] as const;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && !!v))] : [];

/** Normalize presentation settings only. Financial values always come from the shared service. */
export const investmentWidgetSettings = (
  kind: InvestmentWidgetKind,
  stored: Record<string, unknown> = {},
): Record<string, unknown> & { portfolioIds: string[]; benchmarks: string[] } => ({
  ...stored,
  portfolioIds: strings(stored.portfolioIds),
  benchmarks: stored.benchmarks === undefined ? ['SPY'] : strings(stored.benchmarks),
  dateRange: INVESTMENT_DATE_RANGES.includes(stored.dateRange as (typeof INVESTMENT_DATE_RANGES)[number])
    ? stored.dateRange
    : '1Y',
  allocationMode:
    typeof stored.allocationMode === 'string' &&
    INVESTMENT_ALLOCATION_MODES.some(([id]) => id === stored.allocationMode)
      ? stored.allocationMode
      : kind === 'sector'
        ? 'sector'
        : kind === 'geography'
          ? 'country'
          : 'holdings',
  holdingsMode: stored.holdingsMode === 'underlying' ? 'underlying' : 'direct',
  securityId:
    typeof stored.securityId === 'string'
      ? stored.securityId
      : typeof stored.securityFilter === 'string'
        ? stored.securityFilter
        : '',
  grouping: typeof stored.grouping === 'string' ? stored.grouping : 'security',
  sizeBy: ['marketValue', 'costBasis', 'absoluteGain'].includes(String(stored.sizeBy)) ? stored.sizeBy : 'marketValue',
  colorBy: ['daily', 'weekly', 'monthly', 'ytd', '1y', 'unrealized'].includes(String(stored.colorBy))
    ? stored.colorBy
    : 'daily',
  aggregation: ['monthly', 'quarterly', 'yearly'].includes(String(stored.aggregation)) ? stored.aggregation : 'monthly',
  performerPeriod: INVESTMENT_PERFORMER_PERIODS.some(([period]) => period === stored.performerPeriod)
    ? stored.performerPeriod
    : 'unrealized',
  unit: stored.unit === 'percent' ? 'percent' : 'dollars',
  limit:
    typeof stored.limit === 'number' && Number.isInteger(stored.limit) && stored.limit >= 5 && stored.limit <= 100
      ? stored.limit
      : 10,
});
