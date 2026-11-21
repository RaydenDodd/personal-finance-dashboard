<script setup lang="ts">
import { ref, computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { api } from '@/api/_api';
import { Button } from '@/components/lib/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/lib/ui/dialog';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import type { InvestmentAccountHistoryResponse } from '@bt/shared/types/investment-history';
const props = defineProps<{ history: InvestmentAccountHistoryResponse }>();
const open = ref(false);
const details = useQuery({
  queryKey: computed(() => ['investment-analytics', 'history-coverage', props.history.accounts.map((p) => p.id)]),
  enabled: open,
  staleTime: 60000,
  queryFn: async () => {
    const r = await api.get('/investments/analytics/history', {
      portfolioIds: props.history.accounts.map((p) => p.id).join(','),
      audit: true,
      coverageOnly: true,
    });
    return (r.data ?? r) as unknown as InvestmentAccountHistoryResponse;
  },
});
type Audit = {
  needs?: string[];
  securities?: { id: string; symbol: string }[];
  missing?: { securityId: string; kind: string; from: string; through: string }[];
  reconciliations?: { date: string; securityId: string; expected: number | null; observed: number }[];
};
const audit = (p: InvestmentAccountHistoryResponse['accounts'][number]) => p.audit as Audit | undefined;
const symbol = (p: InvestmentAccountHistoryResponse['accounts'][number], id: string) =>
  audit(p)?.securities?.find((s) => s.id === id)?.symbol ?? id;
</script>
<template>
  <div class="flex items-center justify-between gap-2 text-xs">
    <span v-if="history.pending" class="text-muted-foreground" role="status">Updating saved daily account values…</span>
    <Button variant="ghost" size="sm" class="ml-auto text-xs" @click="open = true">History coverage</Button>
  </div>
  <Dialog v-model:open="open"
    ><DialogContent class="flex h-[85dvh] max-w-3xl flex-col overflow-hidden! p-4 sm:p-6"
      ><DialogHeader class="pr-8"
        ><DialogTitle>Historical records</DialogTitle
        ><DialogDescription
          >First purchases, supported dates and the exact records still needed.</DialogDescription
        ></DialogHeader
      >
      <ScrollArea class="min-h-0 flex-1"
        ><div class="space-y-3 pr-3">
          <p v-if="details.isPending.value" class="text-muted-foreground text-sm">Loading record coverage…</p>
          <p v-if="details.isError.value" class="text-app-expense-color text-sm">
            Record coverage could not be loaded. Close and reopen to retry.
          </p>
          <details v-for="p in details.data.value?.accounts ?? []" :key="p.id" class="rounded-md border p-3">
            <summary class="cursor-pointer text-sm font-medium">
              {{ p.name }}
              <span class="text-muted-foreground text-xs">· {{ p.firstPurchase ?? 'No purchase imported' }}</span>
            </summary>
            <dl class="mt-3 grid grid-cols-2 gap-2 text-xs">
              <dt>First imported purchase</dt>
              <dd>{{ p.firstPurchase ?? 'Not recorded' }}</dd>
              <dt>First source record</dt>
              <dd>{{ p.firstDate ?? 'Not recorded' }}</dd>
              <dt>Calculated through</dt>
              <dd>{{ p.lastDate ?? 'Queued' }}</dd>
            </dl>
            <ul class="text-muted-foreground mt-3 space-y-2 text-xs">
              <li v-for="need in audit(p)?.needs ?? []" :key="need">{{ need }}</li>
            </ul>
            <div
              v-for="m in audit(p)?.missing ?? []"
              :key="m.securityId + m.kind + m.from"
              class="mt-3 border-t pt-2 text-xs"
            >
              <strong>{{ symbol(p, m.securityId) }}</strong> · {{ m.from }} – {{ m.through }}
              <p class="text-muted-foreground mt-1">
                {{
                  m.kind === 'price'
                    ? 'Daily closing prices are missing. Supply price history or a dated broker valuation for these dates.'
                    : 'A share movement is unresolved. Supply the missing purchase, transfer or post-action position record for this security.'
                }}
              </p>
            </div>
            <div
              v-for="r in audit(p)?.reconciliations ?? []"
              :key="r.date + r.securityId"
              class="mt-3 border-t pt-2 text-xs"
            >
              <strong>{{ symbol(p, r.securityId) }}</strong> · {{ r.date }}
              <p class="text-muted-foreground mt-1">
                Trades establish {{ r.expected == null ? 'no earlier quantity' : r.expected + ' shares' }}; the dated
                position reports {{ r.observed }} in current-share units. Supply acquisition, disposal, transfer or
                corporate-action records before this observation to reconcile the intervening history.
              </p>
            </div>
          </details>
        </div></ScrollArea
      >
    </DialogContent></Dialog
  >
</template>
