import type { InvestmentAnalytics, InvestmentHolding } from '@bt/shared/types/investment-analytics';

import { chartNumber } from './chart-model';
import { usesCustomPositionPeriod } from './performers-model';

export interface InvestmentTreemapRow {
  id: string;
  name: string;
  symbol: string;
  value: number | null;
  size: number;
  change: number | null;
  group: string;
  weight: number | null;
  description: string;
  asOf: string | null;
}

/** Presentation geometry only; monetary values and identities originate in the shared service. */
export function investmentTreemapRows(
  analytics: InvestmentAnalytics,
  settings: Record<string, unknown>,
): InvestmentTreemapRow[] {
  const money = (value: number | null, currency = analytics.currencyCode) =>
    value == null ? 'Unavailable' : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  const split = settings.grouping === 'brokerage' || settings.grouping === 'accountType';
  const total = chartNumber(analytics.metrics.marketValue?.value ?? analytics.metrics.knownMarketValue?.value);
  const weight = (value: number | null) =>
    total !== null && total > 0 && value !== null ? (value / total) * 100 : null;
  const portfolioGroup = (id: string) => {
    const p = analytics.portfolios.find((row) => row.id === id);
    return settings.grouping === 'brokerage' ? (p?.broker ?? 'Unknown') : (p?.accountType ?? 'Unknown');
  };
  if (settings.holdingsMode === 'underlying') {
    if (settings.sizeBy && settings.sizeBy !== 'marketValue') return [];
    return analytics.exposure.flatMap((row) => {
      if (!split)
        return [
          {
            id: row.id,
            name: row.name,
            symbol: row.symbol,
            value: Number(row.totalValue),
            size: Number(row.totalValue),
            change: null,
            group: String((row as unknown as Record<string, unknown>)[String(settings.grouping)] ?? 'Unknown'),
            weight: chartNumber(row.weight),
            description: `Direct ${money(Number(row.directValue))} · indirect ${money(Number(row.indirectValue))}`,
            asOf: row.sourceDate,
          },
        ];
      return row.contributions.map((source, index) => ({
        id: `${row.id}:${source.portfolioId}:${index}`,
        name: row.name,
        symbol: row.symbol,
        value: Number(source.value),
        size: Number(source.value),
        change: null,
        group: portfolioGroup(source.portfolioId),
        weight: weight(Number(source.value)),
        description: `${source.portfolioName} · ${source.fundSymbol ? `Indirect through ${source.fundSymbol}` : 'Direct position'} · ${money(Number(source.value))}`,
        asOf: source.asOf,
      }));
    });
  }
  const securityReturn = (row: InvestmentHolding, basis: string | null, gain: string | null) => {
    if (settings.colorBy === 'unrealized' || settings.colorBy === 'all' || !settings.colorBy) {
      const b = chartNumber(basis),
        g = chartNumber(gain);
      return b !== null && b > 0 && g !== null ? (g / b) * 100 : null;
    }
    if (usesCustomPositionPeriod(settings, String(settings.colorBy))) return chartNumber(row.personalReturns?.custom);
    return chartNumber(
      settings.colorBy === 'daily'
        ? row.dailyChangePercent
        : (row.personalReturns?.[String(settings.colorBy) as keyof NonNullable<InvestmentHolding['personalReturns']>] ??
            null),
    );
  };
  return analytics.holdings.flatMap((row) => {
    const positions = split
      ? row.accounts
      : [
          {
            portfolioId: '',
            portfolioName: 'Combined position',
            costBasis: row.costBasis,
            unrealizedGain: row.unrealizedGain,
            marketValue: row.marketValue,
            averageCost: row.averageCost,
          },
        ];
    return positions.map((position) => {
      const value = chartNumber(position.marketValue);
      const size =
        settings.sizeBy === 'costBasis'
          ? chartNumber(position.costBasis)
          : settings.sizeBy === 'absoluteGain'
            ? Math.abs(chartNumber(position.unrealizedGain) ?? 0)
            : value;
      return {
        id: split ? `${row.id}:${position.portfolioId}` : row.id,
        name: row.name,
        symbol: row.symbol,
        value,
        size: size ?? 0,
        change: securityReturn(row, position.costBasis, position.unrealizedGain),
        group: split
          ? portfolioGroup(position.portfolioId)
          : String((row as unknown as Record<string, unknown>)[String(settings.grouping)] ?? 'Unknown'),
        weight: split ? weight(value) : chartNumber(row.weight),
        description: `${split ? position.portfolioName + ' · ' : ''}Direct holding · price ${money(chartNumber(row.price), row.currencyCode)} · average cost ${money(chartNumber(position.averageCost), row.currencyCode)}`,
        asOf: row.priceDate,
      };
    });
  });
}
