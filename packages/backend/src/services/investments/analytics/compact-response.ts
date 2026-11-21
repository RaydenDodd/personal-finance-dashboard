import type { InvestmentAnalytics } from '@bt/shared/types/investment-analytics';
/** Transport projection only; archived source data remains stored and accessible to full callers. */
export function compactAnalytics(result: InvestmentAnalytics): InvestmentAnalytics {
  return {
    ...result,
    fundSnapshots: result.fundSnapshots.map((s) => ({
      ...s,
      holdings: [],
      holdingCount: s.holdings.length,
      holdingsOmitted: true,
      provenance: s.provenance ? { ...s.provenance, rawSourceGzipBase64: undefined } : undefined,
    })),
  };
}
