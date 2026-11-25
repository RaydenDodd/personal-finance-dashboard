<script setup lang="ts">
import type { selectedPerformanceSummary } from './performance-summary';

const props = defineProps<{
  summary: ReturnType<typeof selectedPerformanceSummary>;
  currency: string;
  loading?: boolean;
}>();
const signed = (value: string | null | undefined) =>
  value == null ? 'text-muted-foreground' : Number(value) >= 0 ? 'text-app-income-color' : 'text-app-expense-color';
const money = (value: string | null | undefined) =>
  value == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: props.currency, signDisplay: 'exceptZero' }).format(Number(value));
const percent = (value: string | null | undefined) =>
  value == null ? '—' : (Number(value) > 0 ? '+' : '') + Number(value).toFixed(2) + '%';
</script>
<template>
  <div
    data-testid="investment-performance-summary"
    class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm tabular-nums sm:gap-x-3 sm:text-base"
    :title="summary?.date ? 'Latest supported observation: ' + summary.date : 'Selected period gain and return are unavailable.'"
    aria-live="polite"
    :aria-busy="loading"
  >
    <strong class="whitespace-nowrap" :class="signed(summary?.gain)">{{ money(summary?.gain) }}</strong>
    <strong class="whitespace-nowrap" :class="signed(summary?.percent)" title="Estimated return weighted by dated deposits and withdrawals (Modified Dietz). Supported account history only.">{{ percent(summary?.percent) }}</strong>
    <span v-if="summary?.partial" class="text-muted-foreground text-xs" title="Some account values or return evidence are incomplete.">Partial</span>
    <span v-else-if="!summary" class="text-muted-foreground text-xs">{{ loading ? 'Loading' : 'Unavailable' }}</span>
  </div>
</template>
