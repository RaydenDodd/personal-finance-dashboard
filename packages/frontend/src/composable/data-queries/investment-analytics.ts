import { getInvestmentAnalytics } from '@/api/investment-analytics';
import { useQuery } from '@tanstack/vue-query';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

/** All page and widget instances share the same cached request for each selection. */
export function useInvestmentAnalytics({
  portfolioIds = [],
  benchmarks = [],
  enabled = true,
}: {
  portfolioIds?: MaybeRefOrGetter<string[]>;
  benchmarks?: MaybeRefOrGetter<string[]>;
  enabled?: MaybeRefOrGetter<boolean>;
} = {}) {
  const selection = computed(() => ({
    portfolioIds: [...toValue(portfolioIds)].sort(),
    benchmarks: [...toValue(benchmarks)].sort(),
  }));
  return useQuery({
    queryKey: computed(() => ['investment-analytics', selection.value]),
    queryFn: () => getInvestmentAnalytics(selection.value),
    enabled: computed(() => toValue(enabled)),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
