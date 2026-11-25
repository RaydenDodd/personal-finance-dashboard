import { getInvestmentAnalyticsReadModel } from '@/api/investment-analytics';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { usEquityMarketOpen } from '@bt/shared/types/investment-market';
import type { InvestmentAnalyticsSection } from '@bt/shared/types/investment-analytics-read';
import { useQuery } from '@tanstack/vue-query';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

/** All page and widget instances share the same cached request for each selection. */
export function useInvestmentAnalytics({
  portfolioIds = [],
  benchmarks = [],
  enabled = true,
  performanceFrom,
  performanceThrough,
  section = 'all',
}: {
  portfolioIds?: MaybeRefOrGetter<string[]>;
  benchmarks?: MaybeRefOrGetter<string[]>;
  enabled?: MaybeRefOrGetter<boolean>;
  performanceFrom?: MaybeRefOrGetter<string | undefined>;
  performanceThrough?: MaybeRefOrGetter<string | undefined>;
  section?: MaybeRefOrGetter<InvestmentAnalyticsSection>;
} = {}) {
  const { data: userSettings } = useUserSettings();
  const selection = computed(() => ({
    portfolioIds: [...toValue(portfolioIds)].sort(),
    benchmarks: [...toValue(benchmarks)].sort(),
    performanceFrom: toValue(performanceFrom),
    performanceThrough: toValue(performanceThrough),
    section: toValue(section),
  }));
  const query = useQuery({
    queryKey: computed(() => [
      'investment-analytics',
      selection.value,
      [...(userSettings.value?.ui?.hiddenPortfolioIds ?? [])].sort(),
    ]),
    queryFn: () => getInvestmentAnalyticsReadModel(selection.value),
    select: (response) => response.analytics ?? undefined,
    enabled: computed(() => toValue(enabled)),
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchInterval: (query) =>
      !query.state.data?.analytics || query.state.data.status.state !== 'ready'
        ? 15000
        : usEquityMarketOpen() ? 30000 : 60000,
    refetchIntervalInBackground: false,
  });
  return { ...query, isPending: computed(() => query.isPending.value || (!query.isError.value && !query.data.value)) };
}
