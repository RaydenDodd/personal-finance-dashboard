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
import { format, parseISO } from 'date-fns';
import { computed, inject, type Ref } from 'vue';
import WidgetWrapper from './components/widget-wrapper.vue';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { calendarRoles, fundingEntries, monthBounds, monthCells, calendarMonths, type CalendarEntry, spendingEntries, summarizeDay, summarizeDayTotals, calendarTransactionFilters, type FundingCalendarResponse } from './finance-calendar-model';

const config = inject<Ref<DashboardWidgetConfig>>('dashboard-widget-config')!;
const spending = computed(() => config.value.widgetId === 'spending-calendar');
const compact = computed(() => (config.value.rowSpan ?? 1) === 1 || config.value.colSpan === 1);
const { dashboardRange } = useDashboardPeriod();
const { bounded } = useModuleLayout();
const today = payrollToday();
const router = useRouter();
const openDate = (date: string, ids: string[]) => router.push({ name: ROUTES_NAMES.transactions, query: calendarTransactionFilters(date, spending.value, ids) });
// The dashboard is the only date control. A standalone fallback is used only
// if the widget is mounted outside the dashboard.
const range = computed(() => dashboardRange.value ?? { from: today.slice(0, 7) + '-01', through: monthBounds(today.slice(0, 7)).to });
const months = computed(() => calendarMonths(range.value, today));
const requests = computed(() => months.value.filter(m => m.active).map(({from,to}) => ({from,to})));
const multiple = computed(() => months.value.length > 1);
const query = useQuery({
  queryKey: computed(() => [VUE_QUERY_GLOBAL_PREFIXES.transactionChange, spending.value ? 'calendar-spending' : 'calendar-funding', requests.value]),
  queryFn: async ({ signal }) => {
    const isSpending = spending.value;
    const periods = requests.value;
    const rows: CalendarEntry[] = [];
    // Do not fan out many expensive report requests on a small host.
    for (const request of periods) {
      if (signal.aborted) throw new Error('Calendar range changed');
      if (isSpending) rows.push(...spendingEntries(await api.get('/stats/calendar/spending', request) as GetPivotReportResponse));
      else rows.push(...fundingEntries(await api.get('/stats/calendar/funding', request) as FundingCalendarResponse));
    }
    return rows;
  },
  enabled: computed(() => requests.value.length > 0),
  staleTime: 60000,
});
const entriesByDate = computed(() => {
  const grouped = new Map<string, NonNullable<typeof query.data.value>>();
  for (const entry of query.data.value ?? []) {
    if (entry.date < range.value.from || entry.date > range.value.through || entry.date > today) continue;
    const rows = grouped.get(entry.date) ?? [];
    rows.push(entry);
    grouped.set(entry.date, rows);
  }
  return grouped;
});
const sections = computed(() => months.value.map(({month}) => ({
  month,
  cells: monthCells(month).map(cell => {
    if (!cell || cell.date < range.value.from || cell.date > range.value.through) return null;
    const rows = entriesByDate.value.get(cell.date) ?? [];
    const groups = summarizeDay(rows);
    return { ...cell, ids: rows.map(row => row.id), groups, totals: summarizeDayTotals(groups) };
  }),
})));
const pending = computed(() => requests.value.length > 0 && query.isPending.value);
const fetching = computed(() => query.isFetching.value);
const failed = computed(() => requests.value.length > 0 && query.isError.value);
const money = (amount: number, currency: string, compact = false) => {
  if (!currency) return 'Unavailable';
  return new Intl.NumberFormat(undefined, {
    style: 'currency', currency, ...(compact ? { notation: Math.abs(amount) >= 1000 ? 'compact' : 'standard', maximumFractionDigits: Math.abs(amount) >= 1000 ? 1 : 0, minimumFractionDigits: 0 } : {}),
  }).format(amount);
};
const share = (activity: number, total: number) => total ? new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(activity / total) : '0%';
const retry = () => { void query.refetch(); };
</script>

<template>
  <WidgetWrapper :is-fetching="fetching" :compact-header="compact" :content-class="compact ? 'gap-1.5 px-2 pb-2 sm:px-3 sm:pb-3' : 'gap-3'" class="min-w-0 @container/calendar">
    <template #title><span :class="compact ? 'text-sm' : ''" :title="spending ? 'Spending Calendar' : 'Income & Contributions Calendar'">{{ spending ? 'Spending Calendar' : compact ? 'Income & Contributions' : 'Income & Contributions Calendar' }}</span></template>
    <div v-if="!spending" class="flex shrink-0 flex-wrap gap-x-2 gap-y-0.5" :class="compact ? 'text-[10px]' : 'text-xs'">
      <span v-for="role in calendarRoles" :key="role.group" class="inline-flex items-center gap-1">
        <span class="size-2 rounded-full" :style="{ backgroundColor: role.color }" />{{ role.group }}
      </span>
    </div>
    <span v-if="pending" class="sr-only" role="status">Loading activity…</span>
    <div v-if="failed" class="flex flex-wrap items-center gap-2 text-xs" role="alert">
      <span class="text-destructive">Some calendar data could not be loaded.</span>
      <Button size="sm" variant="outline" @click="retry">Retry</Button>
    </div>
    <TooltipProvider :delay-duration="150">
      <component :is="multiple ? ScrollArea : 'div'" :class="[bounded ? 'min-h-0 flex-1' : '', multiple ? 'max-h-full' : 'flex flex-col']" v-bind="multiple ? { type: 'auto', viewportClass: 'pr-2 overscroll-y-auto' } : {}">
      <section v-for="section in sections" :key="section.month" :class="multiple ? 'mb-3' : 'flex min-h-0 flex-1 flex-col'">
      <h4 v-if="multiple" class="mb-1 text-xs font-medium">{{ format(parseISO(section.month + '-01'), 'MMMM yyyy') }}</h4>
      <div class="grid grid-cols-7 text-center"
        :class="[bounded && !multiple ? 'min-h-0 flex-1' : 'shrink-0', compact ? 'gap-0.5 text-[10px]' : 'gap-1 text-xs']"
        :style="{ gridTemplateRows: 'auto repeat(' + section.cells.length / 7 + ', minmax(' + (bounded && !multiple ? '0' : compact ? '2.25rem' : '3rem') + ', 1fr))' }"
        :aria-label="spending ? 'Spending calendar' : 'Income and contributions calendar'">
        <span v-for="day in ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']" :key="day" class="text-muted-foreground">{{ compact ? day.slice(0, 1) : day }}</span>
        <template v-for="(cell, index) in section.cells" :key="index">
          <Tooltip v-if="cell">
            <TooltipTrigger as-child>
              <button type="button"
                class="relative flex min-w-0 flex-col overflow-hidden border text-left tabular-nums focus-visible:ring-2 focus-visible:ring-ring"
                
                :class="[compact ? 'min-h-0 rounded-sm px-0.5 pb-1 leading-tight' : 'min-h-0 rounded-md px-1 pb-2 pt-1', cell.date <= today ? 'cursor-pointer hover:bg-muted/50' : 'opacity-50', !cell.groups.length ? 'text-muted-foreground' : '']"
                :style="cell.groups.length ? { backgroundColor: cell.groups[0]!.color + '18' } : undefined"
                :disabled="cell.date > today || pending || failed"
                :aria-label="cell.date + ': ' + (cell.groups.map(g => g.group + ' ' + money(g.amount, g.currency)).join(', ') || (pending || failed ? 'Activity unavailable' : 'No recorded activity')) + '. View transactions'"
                @click="openDate(cell.date, cell.ids)">
                <span class="font-medium">{{ cell.day }}</span>
                <template v-if="spending || compact">
                  <span v-for="total in cell.totals" :key="total.currency" class="truncate font-semibold" :class="compact ? 'text-[9px]' : 'text-[10px]'">{{ money(spending ? total.amount : total.activity, total.currency, true) }}</span>
                </template>
                <template v-else>
                  <span v-for="group in cell.groups" :key="group.group + group.currency" class="truncate text-[10px] font-semibold">{{ money(group.amount, group.currency, true) }}</span>
                </template>
                <span v-if="cell.groups.length" class="absolute inset-x-0 bottom-0 flex overflow-hidden" :class="compact ? 'h-0.5' : 'h-1.5'" aria-hidden="true">
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
      </section>
      </component>
    </TooltipProvider>
  </WidgetWrapper>
</template>
