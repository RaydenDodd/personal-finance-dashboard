import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useQueryClient } from '@tanstack/vue-query';
import { useDebounceFn } from '@vueuse/core';
import { onScopeDispose, watch } from 'vue';

import { SSE_EVENT_TYPES, useSSE } from './use-sse';

/** One app-level listener refreshes every observer of the existing shared caches. */
export function useInvestmentPriceEvents() {
  const client = useQueryClient(),
    sse = useSSE();
  const refresh = useDebounceFn(
    () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['investment-analytics'] }),
        client.invalidateQueries({ queryKey: ['investment-security-prices'] }),
        client.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.holdingsList.slice(0, 1) }),
      ]),
    300,
  );
  const unsubscribe = sse.on(SSE_EVENT_TYPES.INVESTMENT_PRICES_UPDATED, () => void refresh());
  const stop = watch(sse.isConnected, (connected) => {
    if (connected) void refresh();
  });
  onScopeDispose(() => {
    unsubscribe();
    stop();
  });
}
