import { api } from '@/api/_api';
import type { InvestmentAnalytics, InvestmentFundSnapshot } from '@bt/shared/types/investment-analytics';

export async function getInvestmentAnalytics({
  portfolioIds = [],
  benchmarks = [],
}: { portfolioIds?: string[]; benchmarks?: string[] } = {}): Promise<InvestmentAnalytics> {
  const response = await api.get('/investments/analytics', {
    portfolioIds: portfolioIds.join(','),
    benchmarkSymbols: benchmarks.join(','),
  });
  return response.data ?? response;
}

export async function importFundHoldings(snapshots: InvestmentFundSnapshot[]): Promise<void> {
  await api.post('/investments/analytics/fund-holdings', { snapshots });
}

export async function refreshInvestmentPrices(): Promise<void> {
  await api.post('/investments/sync/securities-prices');
}
