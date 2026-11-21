import type { InvestmentHolding } from '@bt/shared/types/investment-analytics';
import { latestUsEquitySessionDate } from '@bt/shared/types/investment-market';

import { chartNumber } from './chart-model';

export const INVESTMENT_PERFORMER_PERIODS = [
  ['unrealized', 'Unrealized position return'],
  ['daily', 'Daily price change'],
  ['weekly', 'Weekly price change'],
  ['monthly', 'Monthly price change'],
  ['3m', 'Three-month price change'],
  ['6m', 'Six-month price change'],
  ['ytd', 'YTD price change'],
  ['1y', 'One-year price change'],
  ['2y', 'Two-year price change'],
  ['5y', 'Five-year price change'],
  ['all', 'Lifetime holding return'],
  ['custom', 'Selected dates'],
] as const;

/** Ranking uses shared-service returns; unsupported periods remain absent rather than zero. */
export const usesCustomPositionPeriod = (settings: Record<string, unknown>, period: string) =>
  Boolean(
    settings.from &&
    settings.through &&
    !['unrealized', 'all'].includes(period) &&
    (period !== 'daily' || settings.through !== latestUsEquitySessionDate()),
  );
export function rankInvestmentPerformers(
  holdings: InvestmentHolding[],
  period = 'unrealized',
  securityId = '',
  custom = false,
) {
  return holdings
    .filter((row) => !securityId || row.securityId === securityId || row.symbol === securityId)
    .map((row) => ({
      id: row.id,
      securityId: row.securityId,
      symbol: row.symbol,
      name: row.name,
      priceDate: row.priceDate,
      returnValue: chartNumber(
        custom
          ? row.personalReturns?.custom
          : period === 'unrealized' || period === 'all'
            ? row.unrealizedPercent
            : period === 'daily'
              ? row.dailyChangePercent
              : (row.personalReturns?.[period as keyof NonNullable<InvestmentHolding['personalReturns']>] ?? null),
      ),
    }))
    .filter((row): row is typeof row & { returnValue: number } => row.returnValue !== null)
    .sort((left, right) => right.returnValue - left.returnValue || left.symbol.localeCompare(right.symbol));
}
