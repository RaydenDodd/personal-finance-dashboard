<script setup lang="ts">
import { api } from '@/api/_api';
import { loadTransactions } from '@/api/transactions';
import type { DashboardWidgetConfig } from '@/api/user-settings';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { Button } from '@/components/lib/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/lib/ui/dialog';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useModuleLayout } from './composables/use-module-layout';
import { useCategoriesStore } from '@/stores/categories/categories';
import { useDashboardPeriod } from './composables/use-dashboard-period';
import { payrollToday } from '@/pages/income-management/payroll/date-range';
import { TRANSACTION_TYPES, type GetPivotReportResponse } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue';
import { addMonths, endOfDay, format, parseISO, startOfDay } from 'date-fns';
import { computed, inject, ref, watch, type Ref } from 'vue';
import WidgetWrapper from './components/widget-wrapper.vue';
import { calendarRoles, fundingEntries, monthBounds, monthCells, spendingEntries, summarizeDay, type FundingCalendarResponse } from './finance-calendar-model';

const config = inject<Ref<DashboardWidgetConfig>>('dashboard-widget-config')!;
const spending = computed(() => config.value.widgetId === 'spending-calendar');
const { dashboardRange } = useDashboardPeriod();
const { bounded } = useModuleLayout();
const today = payrollToday();
const month = ref(today.slice(0, 7));
const selected = ref<string | null>(null);
const detailLimit = ref(50);
watch(() => dashboardRange.value?.from, (date) => {
  if (date) month.value = date.slice(0, 7);
  selected.value = null;
}, { immediate: true });
watch(month, () => { selected.value = null; });
watch(selected, () => { detailLimit.value = 50; });
const bounds = computed(() => monthBounds(month.value));
const request = computed(() => ({ from: bounds.value.from, to: [bounds.value.to, today].sort()[0]! }));
const active = computed(() => request.value.from <= request.value.to);
const prefix = VUE_QUERY_GLOBAL_PREFIXES.transactionChange;
const spend = useQuery({
  queryKey: computed(() => [prefix, 'calendar-spending', request.value]),
  queryFn: () => api.get('/stats/calendar/spending', request.value) as Promise<GetPivotReportResponse>,
  enabled: computed(() => spending.value && active.value), staleTime: 60000,
});
const funding = useQuery({
  queryKey: computed(() => [prefix, 'calendar-funding', request.value]),
  queryFn: () => api.get('/stats/calendar/funding', request.value) as Promise<FundingCalendarResponse>,
  enabled: computed(() => !spending.value && active.value), staleTime: 60000,
});
const categories = useCategoriesStore();
const records = useQuery({
  queryKey: computed(() => [prefix, 'calendar-spending-records', selected.value, detailLimit.value]),
  queryFn: () => loadTransactions({
    from: startOfDay(parseISO(selected.value!)).toISOString(),
    to: endOfDay(parseISO(selected.value!)).toISOString(),
    transactionType: TRANSACTION_TYPES.expense,
    excludeTransfer: true, excludeBalanceAdjustments: true, isPlanned: false, limit: detailLimit.value, offset: 0,
  }),
  enabled: computed(() => spending.value && !!selected.value && active.value), staleTime: 60000,
});
const recordedPurchases = computed(() => (records.data.value ?? []).filter((row) => !row.excludeFromStats && !row.isPlanned));
const entries = computed(() => !active.value ? [] : (spending.value
  ? spendingEntries(spend.data.value) : fundingEntries(funding.data.value))
    .filter((entry) => entry.date >= request.value.from && entry.date <= request.value.to));
const cells = computed(() => monthCells(month.value).map((cell) => {
  if (!cell) return null;
  const rows = entries.value.filter((entry) => entry.date === cell.date);
  return { ...cell, rows, groups: summarizeDay(rows) };
}));
const selectedRows = computed(() => entries.value.filter((entry) => entry.date === selected.value));
const selectedGroups = computed(() => summarizeDay(selectedRows.value));
const pending = computed(() => active.value && (spending.value ? spend.isPending.value : funding.isPending.value));
const fetching = computed(() => active.value && (spending.value ? spend.isFetching.value : funding.isFetching.value));
const failed = computed(() => spending.value ? spend.isError.value : funding.isError.value);
const monthName = computed(() => format(parseISO(month.value + '-01'), 'MMMM yyyy'));
const move = (delta: number) => { month.value = format(addMonths(parseISO(month.value + '-01'), delta), 'yyyy-MM'); };
const money = (amount: number, currency: string, compact = false) => {
  if (!currency) return 'Unavailable';
  return new Intl.NumberFormat(undefined, {
    style: 'currency', currency, ...(compact ? { notation: Math.abs(amount) >= 1000 ? 'compact' : 'standard', maximumFractionDigits: Math.abs(amount) >= 1000 ? 1 : 0, minimumFractionDigits: 0 } : {}),
  }).format(amount);
};
const netDay = (groups: ReturnType<typeof summarizeDay>) => groups.reduce((sum, group) => sum + group.amount, 0);
const retry = () => { if (spending.value) void spend.refetch(); else void funding.refetch(); };
</script>

<template>
  <WidgetWrapper :is-fetching="fetching" content-class="gap-3" class="min-w-0">
    <template #title>{{ spending ? 'Spending Calendar' : 'Income & Contributions Calendar' }}</template>
    <div class="flex items-center justify-between gap-2">
      <Button variant="ghost" size="icon-sm" aria-label="Previous calendar month" @click="move(-1)"><ChevronLeftIcon class="size-4" /></Button>
      <strong class="text-sm">{{ monthName }}</strong>
      <Button variant="ghost" size="icon-sm" aria-label="Next calendar month" :disabled="month >= today.slice(0, 7)" @click="move(1)"><ChevronRightIcon class="size-4" /></Button>
    </div>
    <div v-if="!spending" class="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      <span v-for="role in calendarRoles" :key="role.group" class="inline-flex items-center gap-1">
        <span class="size-2 rounded-full" :style="{ backgroundColor: role.color }" />{{ role.group }}
      </span>
    </div>
    <p v-if="pending" class="text-muted-foreground text-xs" role="status">Loading recorded activity…</p>
    <div v-if="failed" class="flex flex-wrap items-center gap-2 text-xs" role="alert">
      <span class="text-destructive">Some calendar data could not be loaded.</span>
      <Button size="sm" variant="outline" @click="retry">Retry</Button>
    </div>
    <div class="grid grid-cols-7 gap-1 text-center text-xs"
      :class="bounded ? 'flex-1' : 'shrink-0'"
      :style="{ gridTemplateRows: 'auto repeat(' + cells.length / 7 + ', minmax(3rem, 1fr))' }"
      :aria-label="spending ? 'Spending calendar' : 'Income and contributions calendar'">
      <span v-for="day in ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']" :key="day" class="text-muted-foreground">{{ day }}</span>
      <template v-for="(cell, index) in cells" :key="index">
        <button v-if="cell" type="button"
          class="relative flex min-h-12 min-w-0 flex-col overflow-hidden rounded-md border px-1 pb-2 pt-1 text-left tabular-nums focus-visible:ring-2 focus-visible:ring-ring"
          :class="[cell.rows.length ? 'cursor-pointer hover:bg-muted/50' : 'text-muted-foreground', selected === cell.date ? 'ring-2 ring-ring' : '']"
          :style="cell.groups.length ? { backgroundColor: cell.groups[0]!.color + '18' } : undefined"
          :disabled="!cell.rows.length" :aria-pressed="selected === cell.date"
          :aria-label="cell.date + ': ' + (cell.groups.map(g => g.group + ' ' + money(g.amount, g.currency)).join(', ') || 'No recorded activity')"
          :title="cell.groups.map(g => g.group + ': ' + money(g.amount, g.currency)).join(' · ')"
          @click="selected = selected === cell.date ? null : cell.date">
          <span class="font-medium">{{ cell.day }}</span>
          <span v-if="spending && cell.groups.length" class="truncate text-[10px] font-semibold">{{ money(netDay(cell.groups), cell.groups[0]!.currency, true) }}</span>
          <template v-else>
            <span v-for="group in cell.groups" :key="group.group + group.currency" class="truncate text-[10px] font-semibold" :title="group.group + ': ' + money(group.amount, group.currency)">{{ money(group.amount, group.currency, true) }}</span>
          </template>
          <span v-if="cell.groups.length" class="absolute inset-x-0 bottom-0 flex h-1.5 overflow-hidden" aria-hidden="true">
            <span v-for="group in cell.groups" :key="group.group + group.currency" :style="{ width: group.width + '%', backgroundColor: group.color }" />
          </span>
        </button>
        <span v-else />
      </template>
    </div>
    <p class="text-muted-foreground text-xs">
      {{ spending ? 'Net spending after linked refunds. Colors follow your spending categories.' : 'Recorded bank income and transfers into investments or savings; not additive income.' }}
      Color bands show relative absolute amounts (equal shares for mixed currencies).
    </p>
    <p v-if="!pending && !failed && !entries.length" class="text-muted-foreground text-xs">No recorded activity in this month.</p>
    <Dialog :open="!!selected" @update:open="open => { if (!open) selected = null; }">
      <DialogContent v-if="selected" class="max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ format(parseISO(selected), 'MMMM d, yyyy') }}</DialogTitle>
          <DialogDescription>{{ spending ? 'Spending activity' : 'Income and contribution transactions' }}</DialogDescription>
        </DialogHeader>
        <ScrollArea class="max-h-[60vh] min-w-0" viewport-class="pr-3">
          <div class="space-y-2">
      <div v-for="group in selectedGroups" :key="group.group + group.currency" class="flex items-center justify-between gap-2 text-xs">
        <span class="flex min-w-0 items-center gap-2"><span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: group.color }" />{{ group.group }}</span>
        <strong class="shrink-0 tabular-nums">{{ money(group.amount, group.currency) }}</strong>
      </div>
      <template v-if="!spending">
        <div v-for="row in selectedRows" :key="row.id" class="flex items-start justify-between gap-2 border-t py-2 text-xs">
          <span class="min-w-0"><strong class="block">{{ row.label }}</strong><span class="text-muted-foreground">{{ row.note }}</span></span>
          <strong class="shrink-0 tabular-nums">{{ money(row.amount, row.currency) }}</strong>
        </div>
      </template>
      <template v-else>
        <h5 class="border-t pt-2 text-xs font-semibold">Recorded purchases (before refund adjustments)</h5>
        <p class="text-muted-foreground text-xs">Individual ledger records may differ from the net report above.</p>
        <p v-if="records.isPending.value" class="text-muted-foreground text-xs">Loading purchases…</p>
        <Button v-else-if="records.isError.value" size="sm" variant="outline" @click="records.refetch()">Retry purchases</Button>
        <div v-for="row in recordedPurchases" :key="row.id" class="flex items-start justify-between gap-2 border-t py-2 text-xs">
          <span class="min-w-0 break-words">{{ row.merchantName || row.note || 'Transaction' }}<span class="text-muted-foreground block">{{ categories.categoriesMap[row.categoryId]?.name || 'Uncategorized' }}</span></span>
          <strong class="shrink-0 tabular-nums">{{ money(row.amount, row.currencyCode) }}</strong>
        </div>
        <Button v-if="(records.data.value?.length ?? 0) >= detailLimit && detailLimit < 100" size="sm" variant="outline" @click="detailLimit = 100">Show more purchases</Button>
        <p v-if="detailLimit === 100 && (records.data.value?.length ?? 0) >= 100" class="text-muted-foreground text-xs">Showing first 100 records; the net category totals above are complete for the requested scope.</p>
      </template>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  </WidgetWrapper>
</template>
