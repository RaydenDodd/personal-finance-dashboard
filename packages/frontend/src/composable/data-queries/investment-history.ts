import { api } from "@/api/_api";
import type { InvestmentAnalytics } from "@bt/shared/types/investment-analytics";
import type { InvestmentAccountHistoryResponse } from "@bt/shared/types/investment-history";
import { usEquityMarketOpen } from "@bt/shared/types/investment-market";
import { useQuery } from "@tanstack/vue-query";
import { computed, toValue, type MaybeRefOrGetter } from "vue";

import { useUserSettings } from "./user-settings";

export function historyChartAdapter(
  r: InvestmentAccountHistoryResponse,
): InvestmentAnalytics {
  return {
    generatedAt: r.generatedAt,
    currencyCode: r.currencyCode,
    selectedPortfolioIds: r.accounts.map((p) => p.id),
    portfolios: r.accounts.map((p) => ({
      ...p,
      currencyCode: r.currencyCode,
      historyComplete: false,
      marketValue: null,
      cash: null,
      costBasis: null,
      unrealizedGain: null,
      realizedGain: null,
      observationDate: p.lastDate,
      review: [],
    })),
    metrics: {},
    holdings: [],
    dividends: [],
    events: r.events ?? [],
    exposure: [],
    allocations: {},
    fundSnapshots: [],
    overlap: [],
    benchmarks: [],
    health: [],
    history: r.dates.map((date, i) => ({
      date,
      marketValue: r.accountsFull[i] === r.accounts.length ? r.total[i]! : null,
      knownMarketValue: r.total[i]!,
      netInvested: null,
      knownNetInvested: r.netFunding?.[i] ?? null,
      cumulativeGain: r.gains?.[i] ?? null,
      unrealizedGain: null,
      realizedGain: null,
      returnPercent: null,
      contributions: null,
      withdrawals: null,
      portfolios: Object.fromEntries(
        r.accounts.map((p) => [p.id, p.full[i] ? p.values[i]! : null]),
      ),
      knownPortfolios: Object.fromEntries(
        r.accounts.map((p) => [p.id, p.values[i]!]),
      ),
      coverage: r.accounts.length
        ? (r.accountsFull[i]! / r.accounts.length) * 100
        : 0,
      source: `${r.positionsPriced?.[i] ?? 0} priced positions${r.positionsMissing?.[i] ? " · " + r.positionsMissing[i] + " missing prices" : ""}${r.quantitiesUnknown?.[i] ? " · " + r.quantitiesUnknown[i] + " unknown quantities" : ""} · ${r.accountsFull[i] === r.accounts.length ? "recorded account value" : "partial holdings / cash"}`,
    })),
    coverage: {
      historyStart:
        r.dates[0] ??
        r.accounts
          .map((a) => a.firstDate)
          .filter(Boolean)
          .sort()[0] ??
        null,
      historyEnd: r.dates.at(-1) ?? null,
      costBasisPercent: "0",
      pricePercent: "0",
      lookThroughPercent: "0",
      methodology: [],
    },
    refresh: {
      supported: true,
      lastSuccess:
        r.accounts
          .map((p) => p.builtAt)
          .filter((v): v is string => !!v)
          .sort()
          .at(-1) ?? null,
      provider: "Native account history",
      schedule: "Incremental daily account totals",
    },
    accountHistory: r,
  };
}
export function useInvestmentHistory({
  portfolioIds = [],
  enabled = true,
  includeCapital = false,
  includeEvents = false,
  gainFrom,
}: {
  portfolioIds?: MaybeRefOrGetter<string[]>;
  enabled?: MaybeRefOrGetter<boolean>;
  includeCapital?: MaybeRefOrGetter<boolean>;
  includeEvents?: MaybeRefOrGetter<boolean>;
  gainFrom?: MaybeRefOrGetter<string | undefined>;
} = {}) {
  const { data: settings } = useUserSettings();
  const selection = computed(() => ({
    portfolioIds: [...toValue(portfolioIds)].sort(),
    includeCapital: toValue(includeCapital),
    includeEvents: toValue(includeEvents),
    gainFrom: toValue(gainFrom),
  }));
  return useQuery({
    queryKey: computed(() => [
      "investment-analytics",
      "daily-account-history",
      selection.value,
      [...(settings.value?.ui?.hiddenPortfolioIds ?? [])].sort(),
    ]),
    queryFn: async ({ queryKey }) => {
      const request = queryKey[2] as typeof selection.value;
      const r = await api.get("/investments/analytics/history", {
        ...request,
        portfolioIds: request.portfolioIds.join(","),
      });
      return historyChartAdapter(
        (r.data ?? r) as unknown as InvestmentAccountHistoryResponse,
      );
    },
    enabled: computed(() => toValue(enabled)),
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
    refetchInterval: (q) =>
      q.state.data?.accountHistory?.pending
        ? 10000
        : usEquityMarketOpen()
          ? 5 * 60 * 1000
          : false,
  });
}
