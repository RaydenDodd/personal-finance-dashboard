import type { InvestmentHolding } from '@bt/shared/types/investment-analytics';

import { chartNumber } from './chart-model';

export const INVESTMENT_PERFORMER_PERIODS = [
  ['unrealized', 'Unrealized position return'],
  ['daily', 'Daily price change'],
  ['weekly', 'Weekly price change'],
  ['monthly', 'Monthly price change'],
  ['ytd', 'YTD price change'],
  ['1y', 'One-year price change'],
] as const;

/** Ranking uses shared-service returns; unsupported periods remain absent rather than zero. */
export function rankInvestmentPerformers(holdings: InvestmentHolding[], period = 'unrealized', securityId = '') {
  return holdings
    .filter((row) => !securityId || row.securityId === securityId || row.symbol === securityId)
    .map((row) => ({
      id: row.id,
      securityId: row.securityId,
      symbol: row.symbol,
      name: row.name,
      priceDate: row.priceDate,
      returnValue: chartNumber(
        period === 'unrealized'
          ? row.unrealizedPercent
          : (row.periodReturns?.[period as keyof NonNullable<InvestmentHolding['periodReturns']>] ??
              (period === 'daily' ? row.dailyChangePercent : null)),
      ),
    }))
    .filter((row): row is typeof row & { returnValue: number } => row.returnValue !== null)
    .sort((left, right) => right.returnValue - left.returnValue || left.symbol.localeCompare(right.symbol));
}
