import type { InvestmentAnalytics } from './investment-analytics';

export const investmentAnalyticsSections = [
  'all', 'overview', 'holdings', 'returns', 'exposure', 'dividends', 'contributions', 'benchmarks', 'overlap', 'risk', 'health',
] as const;
export type InvestmentAnalyticsSection = (typeof investmentAnalyticsSections)[number];

export interface InvestmentAnalyticsReadStatus {
  state: 'pending' | 'ready' | 'stale' | 'retrying';
  builtAt: string | null;
}

export interface InvestmentAnalyticsReadResponse {
  analytics: InvestmentAnalytics | null;
  status: InvestmentAnalyticsReadStatus;
}

// Keep the established response shape while omitting unrelated large collections.
// Coverage and portfolio metadata are intentionally retained in every projection.
export function projectInvestmentAnalytics(
  result: InvestmentAnalytics,
  section: InvestmentAnalyticsSection,
): InvestmentAnalytics {
  if (section === 'all') return result;
  const holdings = ['holdings', 'returns', 'exposure', 'overview', 'overlap', 'health'].includes(section);
  return {
    ...result,
    holdings: holdings ? result.holdings : [],
    history: ['returns', 'contributions', 'benchmarks', 'risk'].includes(section) ? result.history : [],
    events: ['returns', 'contributions', 'dividends'].includes(section) ? result.events : [],
    dividends: section === 'dividends' ? result.dividends : [],
    exposure: section === 'exposure' ? result.exposure : [],
    allocations: ['holdings', 'exposure', 'overview'].includes(section) ? result.allocations : {},
    fundSnapshots: ['exposure', 'overlap', 'health'].includes(section) ? result.fundSnapshots : [],
    overlap: section === 'overlap' ? result.overlap : [],
    benchmarks: section === 'benchmarks' ? result.benchmarks : [],
    priceRisk: section === 'risk' ? result.priceRisk : undefined,
  };
}
