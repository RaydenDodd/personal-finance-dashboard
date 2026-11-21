import { getInvestmentAnalytics } from '@/api/investment-analytics';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { usEquityMarketOpen } from '@bt/shared/types/investment-market';
import { useQuery } from '@tanstack/vue-query';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

/** All page and widget instances share the same cached request for each selection. */
export function useInvestmentAnalytics({
  portfolioIds = [],
  benchmarks = [],
  enabled = true,
  performanceFrom,
  performanceThrough,
}: {
  portfolioIds?: MaybeRefOrGetter<string[]>;
  benchmarks?: MaybeRefOrGetter<string[]>;
  enabled?: MaybeRefOrGetter<boolean>;
  performanceFrom?: MaybeRefOrGetter<string | undefined>;
  performanceThrough?: MaybeRefOrGetter<string | undefined>;
} = {}) {
  const { data: userSettings } = useUserSettings();
  const selection = computed(() => ({
    portfolioIds: [...toValue(portfolioIds)].sort(),
    benchmarks: [...toValue(benchmarks)].sort(),
    performanceFrom: toValue(performanceFrom),
    performanceThrough: toValue(performanceThrough),
  }));
  return useQuery({
    queryKey: computed(() => [
      'investment-analytics',
      selection.value,
      [...(userSettings.value?.ui?.hiddenPortfolioIds ?? [])].sort(),
    ]),
    queryFn: () => getInvestmentAnalytics(selection.value),
    enabled: computed(() => toValue(enabled)),
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.composition?.some((row) => row.scheduledRefreshEnabled && !row.lastScheduledRun)
        ? 10000
        : usEquityMarketOpen()
          ? 5 * 60 * 1000
          : false,
    refetchIntervalInBackground: false,
  });
}
