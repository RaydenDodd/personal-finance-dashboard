import type { InvestmentAnalytics } from './investment-analytics';

export const investmentAnalyticsSections = [
  'all', 'page', 'overview', 'holdings', 'returns', 'exposure', 'dividends', 'contributions', 'benchmarks', 'overlap', 'risk', 'health',
] as const;
export type InvestmentAnalyticsSection = (typeof investmentAnalyticsSections)[number];

export interface InvestmentAnalyticsReadStatus {
  state: 'pending' | 'ready' | 'stale' | 'retrying';
  builtAt: string | null;
}

export interface InvestmentAnalyticsReadResponse {
  analytics: InvestmentAnalytics | null;
  status: InvestmentAnalyticsReadStatus;
  unchanged?: boolean;
}

// Keep the established shape. Only fields used by each presentation are included.
export const analyticsCollectionFields = [
  'holdings', 'history', 'events', 'dividends', 'exposure', 'allocations',
  'fundSnapshots', 'overlap', 'benchmarks', 'priceRisk', 'accountHistory',
] as const;
type Collection = (typeof analyticsCollectionFields)[number];
const fieldsBySection: Record<Exclude<InvestmentAnalyticsSection, 'all'>, readonly Collection[]> = {
  page: ['holdings', 'history', 'priceRisk'],
  overview: ['holdings'],
  holdings: ['holdings'],
  returns: ['holdings', 'history', 'events'],
  exposure: ['holdings', 'exposure', 'allocations', 'fundSnapshots'],
  dividends: ['holdings', 'dividends', 'events'],
  contributions: ['history', 'events', 'accountHistory'],
  benchmarks: ['history', 'benchmarks', 'events', 'accountHistory'],
  overlap: ['holdings', 'overlap', 'fundSnapshots'],
  risk: ['history', 'priceRisk', 'events'],
  health: ['holdings', 'fundSnapshots'],
};
export function omittedAnalyticsFields(section: InvestmentAnalyticsSection): Collection[] {
  return section === 'all' ? [] : analyticsCollectionFields.filter((field) => !fieldsBySection[section].includes(field));
}

export function projectInvestmentAnalytics(result: InvestmentAnalytics, section: InvestmentAnalyticsSection): InvestmentAnalytics {
  const projected = { ...result };
  for (const field of omittedAnalyticsFields(section)) {
    if (field === 'priceRisk' || field === 'accountHistory') delete projected[field];
    else if (field === 'allocations') projected.allocations = {};
    else projected[field] = [];
  }
  return projected;
}

export function investmentSectionForWidget(kind: string): InvestmentAnalyticsSection {
  switch (kind) {
    case 'overview': case 'gains': return 'overview';
    case 'holdings': case 'heatmap': case 'performers': return 'holdings';
    case 'allocation': case 'sector': case 'geography': case 'exposure': case 'concentration': return 'exposure';
    case 'dividends': case 'dividend-calendar': return 'dividends';
    case 'benchmark': return 'benchmarks';
    case 'contributions': return 'contributions';
    case 'overlap': return 'overlap';
    case 'risk': return 'risk';
    case 'health': return 'health';
    default: return 'all';
  }
}
