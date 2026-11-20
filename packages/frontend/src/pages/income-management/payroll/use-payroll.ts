import { getPayroll, type PayrollQuery } from '@/api/payroll';
import { useQuery } from '@tanstack/vue-query';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

export const PAYROLL_QUERY_KEY = 'actual-payroll';
export function usePayroll(query: MaybeRefOrGetter<PayrollQuery> = {}) {
  return useQuery({
    queryKey: computed(() => [PAYROLL_QUERY_KEY, toValue(query)]),
    queryFn: () => getPayroll(toValue(query)),
    staleTime: 60_000,
  });
}
