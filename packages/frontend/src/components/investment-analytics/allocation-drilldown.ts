import type { DonutNode } from '@/components/common/charts/drilldown-donut.vue';
import type { InvestmentAnalytics } from '@bt/shared/types/investment-analytics';
/** Presentation grouping of existing exposure contributions, never a second look-through calculation. */
export function allocationDrilldown(analytics: InvestmentAnalytics, mode: string): DonutNode[] {
  return (analytics.allocations[mode] ?? []).map((row) => {
    const holding = analytics.holdings.find((h) => h.id === row.key);
    let children: DonutNode[] = [];
    if (mode === 'holdings' && holding?.isFund) {
      children = analytics.exposure.flatMap((e) => {
        const contributions = e.contributions.filter((c) => c.fundId === holding.id);
        if (!contributions.length) return [];
        const amount = contributions.reduce((sum, c) => sum + Number(c.value), 0);
        return [{ id: e.id, name: e.unknown ? e.name : e.symbol, amount }];
      });
      // A recognized fund without constituent evidence remains a fund in Direct Holdings.
      if (!children.some((c) => !analytics.exposure.find((e) => e.id === c.id)?.unknown)) children = [];
    } else if (!['holdings', 'brokerage', 'accountType'].includes(mode)) {
      children = analytics.exposure
        .filter((e) => row.securityIds.includes(e.id))
        .map((e) => ({
          id: e.id,
          name: e.unknown ? e.name : e.symbol,
          amount: Number(e.totalValue),
          ...(mode === 'underlying'
            ? {
                children: e.contributions.map((c, i) => ({
                  id: c.portfolioId + ':' + (c.fundId ?? 'direct') + ':' + i,
                  name: (c.fundSymbol ?? 'Direct') + ' / ' + c.portfolioName,
                  amount: Number(c.value),
                })),
              }
            : {}),
        }));
      if (mode === 'underlying') children = children[0]?.children ?? [];
    }
    return {
      id: row.key,
      name: row.label,
      amount: Number(row.value),
      ...(children.length ? { children: children.sort((a, b) => b.amount - a.amount) } : {}),
    };
  });
}
