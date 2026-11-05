<script setup lang="ts">
import { api } from '@/api/_api';
import FinanceChart from '@/pages/personal-finance/finance-chart.vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
const props = defineProps<{ accountId: string }>();
interface History {
  label: string;
  grouped: boolean;
  points: Array<{ date: string; balance: number; source: 'imported' | 'bank' }>;
}
const month = ref('all');
const { data, isFetching } = useQuery({
  queryKey: ['bank-account-imported-history', () => props.accountId],
  queryFn: () => api.get(`/personal-finance/bank-history/${props.accountId}`) as Promise<History | null>,
});
const months = computed(() => [...new Set(data.value?.points.map((p) => p.date.slice(0, 7)) ?? [])].sort().reverse());
const points = computed(() =>
  (data.value?.points ?? []).filter((p) => month.value === 'all' || p.date.startsWith(month.value)),
);
const money = (value: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);
</script>
<template>
  <div v-if="isFetching" class="text-muted-foreground py-8 text-sm">Loading balance history…</div>
  <div v-else-if="data" class="grid gap-4 pt-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="font-medium">{{ data.label }}</h2>
      <label class="text-sm"
        >Month
        <select v-model="month" aria-label="Bank history month" class="bg-background rounded-md border px-3 py-2">
          <option value="all">All history</option>
          <option v-for="item in months" :key="item" :value="item">{{ item }}</option>
        </select></label
      >
    </div>
    <p class="text-muted-foreground text-xs">
      {{
        data.grouped
          ? 'Combined history for this account group. Historical group totals are preserved without inventing individual account balances.'
          : 'Imported recorded balances, followed by automated bank balances.'
      }}
    </p>
    <FinanceChart
      :rows="points.map((p) => ({ label: p.date, values: { balance: p.balance } }))"
      :series="[{ id: 'balance', name: data.label, color: 'var(--primary)' }]"
      currency="USD"
    />
    <div class="max-h-80 overflow-auto rounded-md border">
      <table class="w-full text-left text-sm" aria-label="Bank account balance history">
        <thead class="bg-muted/50 text-muted-foreground">
          <tr>
            <th class="p-3">Recorded date</th>
            <th class="p-3 text-right">Balance</th>
            <th class="p-3">Source</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="point in [...points].reverse()" :key="point.date" class="border-t">
            <td class="p-3">{{ point.date }}</td>
            <td class="p-3 text-right tabular-nums">{{ money(point.balance) }}</td>
            <td class="text-muted-foreground p-3 text-xs">
              {{ point.source === 'imported' ? 'Imported history' : 'Bank sync' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  <p v-else class="text-muted-foreground py-8 text-sm">No imported history is mapped to this account.</p>
</template>
