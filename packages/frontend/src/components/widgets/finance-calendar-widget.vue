<script setup lang="ts">
import { api } from '@/api/_api';
import type { DashboardWidgetConfig } from '@/api/user-settings';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { Button } from '@/components/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/lib/ui/tooltip';
import { ROUTES_NAMES } from '@/routes/constants';
import { useRouter } from 'vue-router';
import { useModuleLayout } from './composables/use-module-layout';
import { useDashboardPeriod } from './composables/use-dashboard-period';
import { payrollToday } from '@/pages/income-management/payroll/date-range';
import { type GetPivotReportResponse } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue';
import { addMonths, format, parseISO } from 'date-fns';
import { computed, inject, ref, watch, type Ref } from 'vue';
import WidgetWrapper from './components/widget-wrapper.vue';
import { calendarRoles, fundingEntries, monthBounds, monthCells, spendingEntries, summarizeDay, summarizeDayTotals, calendarTransactionFilters, type FundingCalendarResponse } from './finance-calendar-model';

const config = inject<Ref<DashboardWidgetConfig>>('dashboard-widget-config')!;
const spending = computed(() => config.value.widgetId === 'spending-calendar');
const { dashboardRange } = useDashboardPeriod();
const { bounded } = useModuleLayout();
const today = payrollToday();
const month = ref(today.slice(0, 7));
const router = useRouter();
const openDate = (date: string, ids: string[]) => router.push({ name: ROUTES_NAMES.transactions, query: calendarTransactionFilters(date, spending.value, ids) });
watch(() => dashboardRange.value?.from, (date) => {
  if (date) month.value = date.slice(0, 7);
}, { immediate: true });
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
const entries = computed(() => !active.value ? [] : (spending.value
  ? spendingEntries(spend.data.value) : fundingEntries(funding.data.value))
    .filter((entry) => entry.date >= request.value.from && entry.date <= request.value.to));
const cells = computed(() => monthCells(month.value).map((cell) => {
  if (!cell) return null;
  const rows = entries.value.filter((entry) => entry.date === cell.date);
  const groups = summarizeDay(rows);
  return { ...cell, ids: rows.map(row => row.id), groups, totals: summarizeDayTotals(groups) };
}));
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
const share = (activity: number, total: number) => total ? new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(activity / total) : '0%';
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
    <TooltipProvider :delay-duration="150">
      <div class="grid grid-cols-7 gap-1 text-center text-xs"
        :class="bounded ? 'flex-1' : 'shrink-0'"
        :style="{ gridTemplateRows: 'auto repeat(' + cells.length / 7 + ', minmax(3rem, 1fr))' }"
        :aria-label="spending ? 'Spending calendar' : 'Income and contributions calendar'">
        <span v-for="day in ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']" :key="day" class="text-muted-foreground">{{ day }}</span>
        <template v-for="(cell, index) in cells" :key="index">
          <Tooltip v-if="cell">
            <TooltipTrigger as-child>
              <button type="button"
                class="relative flex min-h-12 min-w-0 flex-col overflow-hidden rounded-md border px-1 pb-2 pt-1 text-left tabular-nums focus-visible:ring-2 focus-visible:ring-ring"
                :class="[cell.date <= today ? 'cursor-pointer hover:bg-muted/50' : 'opacity-50', !cell.groups.length ? 'text-muted-foreground' : '']"
                :style="cell.groups.length ? { backgroundColor: cell.groups[0]!.color + '18' } : undefined"
                :disabled="cell.date > today || (!spending && (pending || failed))"
                :aria-label="cell.date + ': ' + (cell.groups.map(g => g.group + ' ' + money(g.amount, g.currency)).join(', ') || (pending || failed ? 'Activity unavailable' : 'No recorded activity')) + '. View transactions'"
                @click="openDate(cell.date, cell.ids)">
                <span class="font-medium">{{ cell.day }}</span>
                <template v-if="spending">
                  <span v-for="total in cell.totals" :key="total.currency" class="truncate text-[10px] font-semibold">{{ money(total.amount, total.currency, true) }}</span>
                </template>
                <template v-else>
                  <span v-for="group in cell.groups" :key="group.group + group.currency" class="truncate text-[10px] font-semibold">{{ money(group.amount, group.currency, true) }}</span>
                </template>
                <span v-if="cell.groups.length" class="absolute inset-x-0 bottom-0 flex h-1.5 overflow-hidden" aria-hidden="true">
                  <span v-for="group in cell.groups" :key="group.group + group.currency" :style="{ width: group.width + '%', backgroundColor: group.color }" />
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent v-if="cell.date <= today" class="min-w-52 max-w-[min(90vw,24rem)] p-3 text-xs" :side-offset="6">
              <div class="space-y-2">
                <p class="font-semibold">{{ format(parseISO(cell.date), 'MMMM d, yyyy') }}</p>
                <div v-for="total in cell.totals" :key="total.currency" class="space-y-1.5 border-t pt-2">
                  <div class="flex items-center justify-between gap-4 font-semibold">
                    <span>{{ spending ? 'Total spending' : 'Total activity' }}{{ cell.totals.length > 1 ? ' (' + total.currency + ')' : '' }}</span>
                    <span class="tabular-nums">{{ money(spending ? total.amount : total.activity, total.currency) }}</span>
                  </div>
                  <div v-for="group in cell.groups.filter(g => g.currency === total.currency)" :key="group.group + group.currency" class="flex items-center gap-2">
                    <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: group.color }" />
                    <span class="min-w-0 flex-1">{{ group.group }}</span>
                    <span class="shrink-0 tabular-nums">{{ money(group.amount, group.currency) }}</span>
                    <span class="text-muted-foreground w-12 shrink-0 text-right tabular-nums">{{ share(group.activity, total.activity) }}</span>
                  </div>
                  <p v-if="total.activity !== total.amount" class="text-muted-foreground text-[10px]">Percent of absolute activity</p>
                </div>
                <p v-if="!cell.groups.length" class="text-muted-foreground">{{ pending ? 'Loading activity…' : failed ? 'Activity unavailable' : 'No recorded activity' }}</p>
              </div>
            </TooltipContent>
          </Tooltip>
          <span v-else />
        </template>
      </div>
    </TooltipProvider>
  </WidgetWrapper>
</template>
