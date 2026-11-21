import type { InvestmentHolding } from '@bt/shared/types/investment-analytics';
import { latestUsEquitySessionDate } from '@bt/shared/types/investment-market';

import { chartNumber } from './chart-model';

export const INVESTMENT_PERFORMER_PERIODS = [
  ['unrealized', 'Unrealized position return'],
  ['daily', 'Daily holding gain / loss'],
  ['weekly', 'Weekly holding return'],
  ['monthly', 'Monthly holding return'],
  ['3m', 'Three-month holding return'],
  ['6m', 'Six-month holding return'],
  ['ytd', 'YTD holding return'],
  ['1y', 'One-year holding return'],
  ['2y', 'Two-year holding return'],
  ['5y', 'Five-year holding return'],
  ['all', 'Open-position unrealized return'],
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
