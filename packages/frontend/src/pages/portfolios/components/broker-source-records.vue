<script setup lang="ts">
import { api } from '@/api/_api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/lib/ui/card';
import UiButton from '@/components/lib/ui/button/Button.vue';
import FinanceChart from '@/pages/personal-finance/finance-chart.vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';

type Snapshot = {
  id: string;
  asOf: string;
  source: string;
  totalValue: string | null;
  cash: string | null;
  positions: { marketValue: string; costBasis: string | null }[];
  lots: unknown[];
};
type Source = {
  broker: string;
  snapshots: Snapshot[];
  documents: { name: string }[];
  review: string[];
  historyComplete: boolean;
  taxReports: {
    year: number;
    source: string;
    dividends: string | null;
    proceeds: string | null;
    costBasis: string | null;
    realizedGain: string | null;
  }[];
};
const props = defineProps<{ portfolioId: string }>();
const queryClient = useQueryClient();
const { data } = useQuery({
  queryKey: computed(() => ['broker-records', props.portfolioId]),
  queryFn: async (): Promise<Source | null> => api.get(`/investments/portfolios/${props.portfolioId}/broker-records`),
});
const { data: status, refetch } = useQuery({
  queryKey: ['public-provider'],
  queryFn: async (): Promise<{ connected: boolean; lastSyncAt: string | null; error: string | null }> =>
    api.get('/investments/providers/public'),
  enabled: computed(() => data.value?.broker === 'public'),
});
const refreshing = ref(false);
const refresh = async () => {
  refreshing.value = true;
  try {
    await api.post('/investments/providers/public/refresh');
    await queryClient.invalidateQueries();
  } catch {
    // The API client displays the error; keep the existing source observations visible.
  } finally {
    refreshing.value = false;
    await refetch();
  }
};
const latest = computed(() => [...(data.value?.snapshots ?? [])].sort((a, b) => b.asOf.localeCompare(a.asOf))[0]);
const taxReports = computed(() => [...(data.value?.taxReports ?? [])].sort((a, b) => b.year - a.year));
const rows = computed(() =>
  [...new Map((data.value?.snapshots ?? []).map((s) => [s.asOf.slice(0, 10), s])).values()].map((s) => ({
    label: s.asOf.slice(0, 10),
    values: {
      value:
        s.totalValue === null ? s.positions.reduce((sum, p) => sum + Number(p.marketValue), 0) : Number(s.totalValue),
    },
  })),
);
const dollars = (v: string | null) =>
  v === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v));
</script>

<template>
  <Card v-if="data">
    <CardHeader class="flex flex-row flex-wrap items-center justify-between gap-3">
      <div>
        <CardTitle>Broker records</CardTitle>
        <p class="text-muted-foreground mt-1 text-sm">
          {{ data.documents.length }} source documents · {{ data.snapshots.length }} dated observations
        </p>
      </div>
      <UiButton v-if="data.broker === 'public'" :disabled="refreshing" variant="outline" size="sm" @click="refresh">{{
        refreshing ? 'Refreshing…' : 'Refresh Public'
      }}</UiButton>
    </CardHeader>
    <CardContent class="space-y-5">
      <div v-if="data.broker === 'public'" class="text-muted-foreground text-sm">
        Read-only · Syncs every 6 hours · Last successful sync:
        {{ status?.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : 'Pending' }}
        <p v-if="status?.error" class="text-destructive-text mt-1">{{ status.error }}</p>
      </div>
      <p v-if="latest" class="text-muted-foreground text-sm">
        Latest observation: {{ latest.asOf.slice(0, 10) }} · {{ latest.source }}<br />Cash: {{ dollars(latest.cash) }} ·
        {{ latest.lots.length }} reported tax lots
      </p>
      <div v-if="rows.length > 1">
        <h3 class="mb-3 font-medium">Recorded portfolio value</h3>
        <FinanceChart :rows="rows" :series="[{ id: 'value', name: 'Recorded value', color: '#8264cf' }]" mode="line" />
        <p class="text-muted-foreground text-xs">
          Only source observations are plotted. A connecting line does not represent daily measurements or an investment
          return.
        </p>
      </div>
      <div v-if="data.taxReports.length" class="overflow-x-auto">
        <h3 class="mb-3 font-medium">Broker tax summaries</h3>
        <table class="w-full text-sm">
          <thead>
            <tr class="border-border border-b text-left">
              <th class="py-2">Tax year</th>
              <th class="py-2 text-right">Dividends</th>
              <th class="py-2 text-right">Sale proceeds</th>
              <th class="py-2 text-right">Reported realized gain</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tax in taxReports" :key="tax.year" class="border-border border-b" :title="tax.source">
              <td class="py-3">{{ tax.year }}</td>
              <td class="text-right">{{ dollars(tax.dividends) }}</td>
              <td class="text-right">{{ dollars(tax.proceeds) }}</td>
              <td class="text-right">{{ dollars(tax.realizedGain) }}</td>
            </tr>
          </tbody>
        </table>
        <p class="text-muted-foreground mt-2 text-xs">
          Annual tax evidence is kept separately from trades and dividends to avoid duplicate cash movements.
        </p>
      </div>
      <details v-if="data.review.length" class="text-muted-foreground text-sm">
        <summary class="hover:text-foreground cursor-pointer">
          Source coverage and reconciliation ({{ data.review.length }})
        </summary>
        <ul class="mt-3 list-disc space-y-2 pl-5">
          <li v-for="item in data.review" :key="item">{{ item }}</li>
        </ul>
      </details>
    </CardContent>
  </Card>
</template>
