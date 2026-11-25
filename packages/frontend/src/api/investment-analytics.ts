import { api } from '@/api/_api';
import type { InvestmentAnalyticsReadResponse, InvestmentAnalyticsSection } from '@bt/shared/types/investment-analytics-read';
import type {
  FundCompositionStatus,
  InvestmentFundOverlap,
  InvestmentAnalytics,
  InvestmentFundSnapshot,
} from '@bt/shared/types/investment-analytics';

export async function getInvestmentAnalytics({
  portfolioIds = [],
  benchmarks = [],
  performanceFrom,
  performanceThrough,
}: {
  portfolioIds?: string[];
  benchmarks?: string[];
  performanceFrom?: string;
  performanceThrough?: string;
} = {}): Promise<InvestmentAnalytics> {
  const response = await api.get('/investments/analytics', {
    portfolioIds: portfolioIds.join(','),
    benchmarkSymbols: benchmarks.join(','),
    compact: true,
    performanceFrom,
    performanceThrough,
  });
  return response.data ?? response;
}

export async function importFundHoldings(snapshots: InvestmentFundSnapshot[]): Promise<void> {
  await api.post('/investments/analytics/fund-holdings', { snapshots });
}
export async function getInvestmentOverlapDetail(
  leftId: string,
  rightId: string,
  portfolioIds: string[],
): Promise<InvestmentFundOverlap> {
  const result = await api.get('/investments/analytics/overlap-detail', {
    leftId,
    rightId,
    portfolioIds: portfolioIds.join(','),
  });
  return result.data ?? result;
}

export async function refreshInvestmentPrices(): Promise<void> {
  await api.post('/investments/analytics/prices/refresh');
}
export type CompositionCatalogFund = FundCompositionStatus & {
  id: string;
  excludedFromAnalytics: boolean;
  identityConflict: boolean;
};
export interface CompositionCatalog {
  funds: CompositionCatalogFund[];
  sources: {
    symbol: string;
    aliases?: string[];
    issuerUrl: string;
    adapter: string;
    seriesId?: string;
    secUrl?: string;
  }[];
  schedule: string;
}
export async function getCompositionCatalog(): Promise<CompositionCatalog> {
  const response = await api.get('/investments/analytics/composition');
  return response.data ?? response;
}
export async function inspectCompositionFile(input: {
  fundId: string;
  symbol: string;
  adapter: string;
  fileName: string;
  base64: string;
  sourceUrl?: string;
  asOf?: string;
  commit: boolean;
}): Promise<{ snapshot: InvestmentFundSnapshot; result?: { inserted: number; duplicates: number } }> {
  const response = await api.post('/investments/analytics/composition/file', input);
  return response.data ?? response;
}
export async function refreshFundComposition(
  fundIds: string[],
  contact: string,
): Promise<{ results: { symbol: string; status: string; error?: string }[] }> {
  const response = await api.post('/investments/analytics/composition/refresh', { fundIds, contact });
  return response.data ?? response;
}
export async function setCompositionSchedule(enabled: boolean, contact?: string): Promise<void> {
  await api.post('/investments/analytics/composition/schedule', { enabled, ...(contact ? { contact } : {}) });
}

export async function getInvestmentAnalyticsReadModel({
  portfolioIds = [], benchmarks = [], performanceFrom, performanceThrough, section = 'all',
}: {
  portfolioIds?: string[];
  benchmarks?: string[];
  performanceFrom?: string;
  performanceThrough?: string;
  section?: InvestmentAnalyticsSection;
}): Promise<InvestmentAnalyticsReadResponse> {
  const response = await api.get('/investments/analytics/read-model', {
    portfolioIds: portfolioIds.join(','),
    benchmarkSymbols: benchmarks.join(','),
    performanceFrom,
    performanceThrough,
    section,
  });
  return response.data ?? response;
}
