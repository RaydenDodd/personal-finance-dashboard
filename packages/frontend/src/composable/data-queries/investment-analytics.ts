import { getInvestmentAnalyticsReadModel } from '@/api/investment-analytics';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { usEquityMarketOpen } from '@bt/shared/types/investment-market';
import type { InvestmentAnalyticsSection } from '@bt/shared/types/investment-analytics-read';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
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
  const client = useQueryClient();
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
    queryFn: async ({ queryKey }) => {
      const previous = client.getQueryData<Awaited<ReturnType<typeof getInvestmentAnalyticsReadModel>>>(queryKey);
      const request = queryKey[1] as typeof selection.value;
      const next = await getInvestmentAnalyticsReadModel({
        ...request,
        knownBuiltAt: previous?.analytics ? previous.status.builtAt ?? undefined : undefined,
      });
      return next.unchanged && previous?.analytics ? { ...next, analytics: previous.analytics } : next;
    },
    select: (response) => response.analytics ?? undefined,
    enabled: computed(() => toValue(enabled)),
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchInterval: (query) =>
      !query.state.data?.analytics || query.state.data.status.state !== 'ready'
        ? (query.state.data?.analytics ? 30000 : 5000)
        : usEquityMarketOpen() ? 60000 : 120000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });
  return { ...query, isPending: computed(() => query.isPending.value || (!query.isError.value && !query.data.value)) };
}
