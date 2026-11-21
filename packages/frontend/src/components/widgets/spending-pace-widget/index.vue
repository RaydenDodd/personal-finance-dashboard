<script setup lang="ts">
import { getCashFlow } from '@/api/stats';
import { loadTransactions } from '@/api/transactions';
import type { DashboardWidgetConfig } from '@/api/user-settings';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import {
  ChartTooltip,
  ChartTooltipDivider,
  ChartTooltipHeader,
  ChartTooltipRow,
  ChartTooltipSection,
} from '@/components/common/charts/chart-tooltip';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { useNotificationCenter } from '@/components/notification-center';
import { usePayeeLookup } from '@/composable/data-queries/payees';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { useFormatCurrency } from '@/composable/formatters';
import { useDateLocale } from '@/composable/use-date-locale';
import { captureException } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { useCategoriesStore, useRootStore } from '@/stores';
import { SORT_DIRECTIONS, TRANSACTION_SORT_FIELD, TRANSACTION_TYPES } from '@bt/shared/types';
import { GaugeIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { useElementSize } from '@vueuse/core';
import { useChartInteraction } from '@/composable/charts/use-chart-interaction';
import PacePlot from './pace-plot.vue';
import { buildPaceGeometry } from './pace-geometry';
import { addDays, format, subMonths } from 'date-fns';
import { storeToRefs } from 'pinia';
import { type Ref, computed, inject, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import EmptyState from '../components/empty-state.vue';
import ErrorState from '../components/error-state.vue';
import LoadingState from '../components/loading-state.vue';
import WidgetWrapper from '../components/widget-wrapper.vue';
import { useIncludePlannedConfig } from '../use-include-planned-config';
import {
  COMPARISON_MONTHS,
  INCLUDE_PLANNED_DEFAULT,
  type CompareMode,
  getPayMonth,
  parseCompareMode,
  type PaceTone,
  computeSpendingPace,
  formatPacePercent,
  parseSpikePercent,
  spikeContributorsCount,
  spikeDays,
  splitDailyExpenses,
  upcomingPlannedExpenses,
} from './helpers';
import SpendingPaceSettingsPopover from './spending-pace-settings-popover.vue';

defineOptions({ name: 'spending-pace-widget' });

const SENTRY_SCOPE = 'spending-pace-widget';
const AXIS_DAYS = [1, 8, 15, 22, 29];
const AXIS_TODAY_GAP_DAYS = 2;
const TOOLTIP_OFFSET_PX = 10;
const SPIKE_TOP_TRANSACTIONS = 3;

const TONES: Record<PaceTone, { stroke: string; fill: string; border: string; pill: string }> = {
  over: {
    stroke: 'stroke-app-expense-color',
    fill: 'fill-app-expense-color',
    border: 'border-app-expense-color',
    pill: 'bg-app-expense-color/15 text-app-expense-color',
  },
  under: {
    stroke: 'stroke-app-income-color',
    fill: 'fill-app-income-color',
    border: 'border-app-income-color',
    pill: 'bg-app-income-color/15 text-app-income-color',
  },
  neutral: {
    stroke: 'stroke-primary',
    fill: 'fill-primary',
    border: 'border-primary',
    pill: 'bg-muted text-muted-foreground',
  },
};

const { t } = useI18n();
const { addErrorNotification, addSuccessNotification } = useNotificationCenter();
const { format: formatLocal } = useDateLocale();
const { formatBaseCurrency, formatWholeBaseCurrency } = useFormatCurrency();
const { isAppInitialized } = storeToRefs(useRootStore());
const { categoriesMap } = storeToRefs(useCategoriesStore());
const { byId: payeesById } = usePayeeLookup();

const { data: userSettings, isPending: isSettingsPending } = useUserSettings();
const payday = computed(() => userSettings.value?.payday ?? 1);
const isReady = computed(() => isAppInitialized.value && !isSettingsPending.value);

const now = new Date();
const payMonth = computed(() => getPayMonth({ now, payday: payday.value }));

const widgetConfigRef = inject<Ref<DashboardWidgetConfig> | null>('dashboard-widget-config', null);
const saveWidgetConfig = inject<
  ((params: { widgetId: string; config: Record<string, unknown> }) => Promise<void>) | null
>('dashboard-save-widget-config', null);

const pendingConfig = ref<Partial<{ compare: CompareMode; spikePercent: number }>>({});
const compareMode = computed<CompareMode>(
  () => pendingConfig.value.compare ?? parseCompareMode({ value: widgetConfigRef?.value?.config?.compare }),
);
const spikePercent = computed(
  () => pendingConfig.value.spikePercent ?? parseSpikePercent({ value: widgetConfigRef?.value?.config?.spikePercent }),
);

let latestSaveId = 0;

// Each save sends every pending field so overlapping saves can't drop one another's changes.
const saveConfig = async ({ patch }: { patch: typeof pendingConfig.value }): Promise<boolean> => {
  if (!saveWidgetConfig || !widgetConfigRef?.value) return false;
  const saveId = ++latestSaveId;
  pendingConfig.value = { ...pendingConfig.value, ...patch };
  try {
    await saveWidgetConfig({ widgetId: widgetConfigRef.value.widgetId, config: { ...pendingConfig.value } });
    return true;
  } catch (error) {
    captureException({ error, context: { scope: `${SENTRY_SCOPE}:persist-settings` } });
    addErrorNotification(t('errors.api.unexpectedError'));
    return false;
  } finally {
    if (saveId === latestSaveId) pendingConfig.value = {};
  }
};

const setSpikePercent = async ({ value }: { value: number }) => {
  if (await saveConfig({ patch: { spikePercent: value } })) {
    addSuccessNotification(t('dashboard.widgets.spendingPace.settings.saved'));
  }
};

const { includePlanned } = useIncludePlannedConfig({ defaultValue: INCLUDE_PLANNED_DEFAULT });

const cashFlowRange = computed(() => ({
  from: subMonths(payMonth.value.start, COMPARISON_MONTHS),
  to: payMonth.value.end,
  granularity: 'daily' as const,
}));

const { data, isFetching, isError, error, refetch } = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.widgetSpendingPace, format(payMonth.value.start, 'yyyy-MM-dd')]),
  queryFn: () => getCashFlow({ ...cashFlowRange.value, excludePlanned: true }),
  staleTime: Infinity,
  enabled: isReady,
});

const {
  data: withPlanned,
  isFetching: isPlannedFetching,
  error: plannedError,
} = useQuery({
  queryKey: computed(() => [
    ...VUE_QUERY_CACHE_KEYS.widgetSpendingPace,
    'planned',
    format(payMonth.value.start, 'yyyy-MM-dd'),
  ]),
  queryFn: () => getCashFlow(cashFlowRange.value),
  staleTime: Infinity,
  enabled: computed(() => isReady.value && includePlanned.value),
});

watch(error, (value) => {
  if (value) captureException({ error: value, context: { scope: `${SENTRY_SCOPE}:load` } });
});

watch(plannedError, (value) => {
  if (value) captureException({ error: value, context: { scope: `${SENTRY_SCOPE}:load-planned` } });
});

const split = computed(() => splitDailyExpenses({ periods: data.value?.periods ?? [], now, payday: payday.value }));
const fullMonthsCount = computed(() => split.value.fullMonths.length);
const hasHistory = computed(() => fullMonthsCount.value > 0);

const plannedExpenses = computed(() =>
  includePlanned.value && data.value && withPlanned.value
    ? upcomingPlannedExpenses({
        actualPeriods: data.value.periods,
        withPlannedPeriods: withPlanned.value.periods,
        now,
        payday: payday.value,
      })
    : [],
);

const pace = computed(() =>
  computeSpendingPace({
    currentMonth: split.value.currentMonth,
    comparisonMonths: compareMode.value === 'last' ? split.value.fullMonths.slice(-1) : split.value.fullMonths,
    daysInMonth: payMonth.value.daysInMonth,
    plannedExpenses: plannedExpenses.value,
  }),
);
const comparison = computed(() => pace.value.comparison);
const tone = computed(() => TONES[comparison.value?.tone ?? 'neutral']);
const hasForecast = computed(() => !!comparison.value && payMonth.value.daysLeft > 0);
const forecastSpikeDays = computed(() => {
  const lastMonth = split.value.fullMonths.at(-1);
  if (compareMode.value !== 'last' || !lastMonth) return [];
  return spikeDays({ values: lastMonth, percent: spikePercent.value }).filter(
    (day) => day > payMonth.value.todayIndex && day < payMonth.value.daysInMonth,
  );
});

const comparisonName = computed(() =>
  compareMode.value === 'last'
    ? formatLocal(payMonth.value.prevStart, 'LLL')
    : t('dashboard.widgets.spendingPace.comparison.average', { n: comparison.value?.monthsCount ?? 0 }),
);

const compareTabs = computed<{ value: CompareMode; label: string }[]>(() => [
  { value: 'last', label: t('dashboard.widgets.spendingPace.tabs.lastMonth') },
  { value: 'avg', label: t('dashboard.widgets.spendingPace.tabs.average') },
]);

const stats = computed(() => {
  const value = comparison.value;
  if (!value) return [];
  return [
    {
      key: 'byToday',
      label: t('dashboard.widgets.spendingPace.stats.byToday', { name: comparisonName.value }),
      value: formatWholeBaseCurrency(value.byToday),
    },
    {
      key: 'total',
      label: t('dashboard.widgets.spendingPace.stats.total', { name: comparisonName.value }),
      value: formatWholeBaseCurrency(value.total),
    },
    {
      key: 'daysLeft',
      label: t('dashboard.widgets.spendingPace.stats.daysLeft'),
      value: String(payMonth.value.daysLeft),
    },
  ];
});

const footHint = computed(() => {
  if (includePlanned.value && plannedError.value) return t('dashboard.widgets.spendingPace.hints.plannedFailed');
  if (!hasHistory.value) return t('dashboard.widgets.spendingPace.hints.noHistory');
  if (compareMode.value === 'avg' && fullMonthsCount.value < COMPARISON_MONTHS) {
    return t('dashboard.widgets.spendingPace.hints.fewMonths', fullMonthsCount.value);
  }
  return null;
});

const plotRef = useTemplateRef<HTMLElement>('plotRef');
const { width, height } = useElementSize(plotRef);

const geometry = computed(() =>
  buildPaceGeometry({
    width: width.value,
    height: height.value,
    actual: pace.value.spentCumulative,
    comparison: comparison.value?.cumulative ?? null,
    forecast: hasForecast.value ? (comparison.value?.forecastCumulative ?? null) : null,
    todayIndex: payMonth.value.todayIndex,
    days: payMonth.value.daysInMonth,
    spikeDays: forecastSpikeDays.value,
  }),
);

const axisTicks = computed(() => {
  const { start, daysInMonth, todayIndex } = payMonth.value;
  const left = ({ day }: { day: number }) => `${((day - 1) / (daysInMonth - 1)) * 100}%`;
  const shift = ({ day }: { day: number }) => {
    if (day === 1) return 'translate-x-0';
    return day === daysInMonth ? '-translate-x-full' : '-translate-x-1/2';
  };
  const todayDay = todayIndex + 1;
  const days = AXIS_DAYS.filter((day) => day <= daysInMonth && Math.abs(day - todayDay) > AXIS_TODAY_GAP_DAYS);
  return [...days, todayDay].map((day) => {
    const isToday = day === todayDay;
    return {
      key: isToday ? 'today' : String(day),
      label: isToday ? t('dashboard.widgets.spendingPace.chart.today') : formatLocal(addDays(start, day - 1), 'MMM d'),
      left: left({ day }),
      shift: shift({ day }),
      isToday,
    };
  });
});

const hoverIndex = ref<number | null>(null);
const { isScrolling } = useChartInteraction({
  containerRef: plotRef,
  clear: () => {
    hoverIndex.value = null;
  },
});
const onPointer = (event: PointerEvent) => {
  if (isScrolling()) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  hoverIndex.value = Math.round(ratio * (payMonth.value.daysInMonth - 1));
};

const spikeDate = computed<string | null>(() => {
  const day = hoverIndex.value;
  if (day === null || !forecastSpikeDays.value.includes(day)) return null;
  return format(addDays(payMonth.value.prevStart, day), 'yyyy-MM-dd');
});

const { data: spikeTransactions, error: spikeError } = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.widgetSpendingPace, 'spike', spikeDate.value]),
  queryFn: () =>
    loadTransactions({
      from: `${spikeDate.value}T00:00:00.000Z`,
      to: `${spikeDate.value}T23:59:59.999Z`,
      transactionType: TRANSACTION_TYPES.expense,
      excludeTransfer: true,
      isPlanned: false,
      sortBy: TRANSACTION_SORT_FIELD.refAmount,
      order: SORT_DIRECTIONS.desc,
      limit: SPIKE_TOP_TRANSACTIONS,
    }),
  enabled: computed(() => !!spikeDate.value),
  staleTime: Infinity,
});

watch(spikeError, (value) => {
  if (value) captureException({ error: value, context: { scope: `${SENTRY_SCOPE}:spike` } });
});

const spikeBreakdown = computed(() => {
  const day = hoverIndex.value;
  const items = spikeTransactions.value;
  if (!spikeDate.value || day === null || spikeError.value || items?.length === 0) return null;
  const title = t('dashboard.widgets.spendingPace.tooltip.spikeFrom', {
    date: formatLocal(addDays(payMonth.value.prevStart, day), 'MMM d'),
  });
  if (!items) return { title, rows: null };
  const amounts = items.map((tx) => Math.abs(tx.refAmount));
  const count = spikeContributorsCount({ amounts, dayTotal: split.value.fullMonths.at(-1)?.[day] ?? 0 });
  return {
    title,
    rows: items.slice(0, count).map((tx, i) => ({
      id: tx.id,
      label:
        (tx.payeeId && payeesById.value.get(tx.payeeId)?.name) || tx.note || categoriesMap.value[tx.categoryId]?.name,
      value: formatWholeBaseCurrency(amounts[i]!),
    })),
  };
});

const hover = computed(() => {
  const day = hoverIndex.value;
  const chart = geometry.value;
  if (day === null || !chart) return null;
  const cmp = comparison.value;
  const { start, todayIndex } = payMonth.value;
  const isPast = day <= todayIndex;
  if (!isPast && !cmp) return null;

  const x = chart.x(day);
  return {
    x,
    date: formatLocal(addDays(start, day), 'MMM d'),
    isToday: day === todayIndex,
    spent: isPast ? pace.value.spentCumulative[day]! : null,
    forecast: isPast ? null : (cmp?.forecastCumulative[day] ?? null),
    comparison: cmp?.cumulative[day] ?? null,
    style:
      x > width.value / 2
        ? { right: `${width.value - x + TOOLTIP_OFFSET_PX}px` }
        : { left: `${x + TOOLTIP_OFFSET_PX}px` },
  };
});

const isInitialLoading = computed(() => !data.value && (isFetching.value || !isReady.value));
const isEmpty = computed(() => !hasHistory.value && pace.value.spent === 0);
</script>

<template>
  <WidgetWrapper class="@container" :is-fetching="isFetching || isPlannedFetching">
    <template #title>{{ $t('dashboard.widgets.registry.spendingPace.name') }}</template>

    <template v-if="!isInitialLoading && !isError && !isEmpty" #action>
      <div class="flex items-center gap-1">
        <PillTabs
          :items="compareTabs"
          :model-value="compareMode"
          :disabled="!hasHistory"
          size="sm"
          class="[&_button]:px-2 [&_button]:text-xs"
          @update:model-value="(value) => saveConfig({ patch: { compare: parseCompareMode({ value }) } })"
        />
        <SpendingPaceSettingsPopover
          :spike-percent="spikePercent"
          @update:spike-percent="(value) => setSpikePercent({ value })"
        />
      </div>
    </template>

    <template v-if="isInitialLoading">
      <LoadingState />
    </template>

    <template v-else-if="isError">
      <ErrorState :message="$t('dashboard.widgets.spendingPace.loadFailed')" @retry="refetch()" />
    </template>

    <template v-else-if="isEmpty">
      <EmptyState>
        <GaugeIcon class="size-32" />
      </EmptyState>
    </template>

    <div v-else class="flex min-h-0 flex-1 flex-col gap-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-muted-foreground text-xs">
            {{ $t('dashboard.widgets.spendingPace.spentIn', { month: formatLocal(payMonth.start, 'LLL') }) }}
          </p>
          <p class="text-2xl font-bold tracking-tight tabular-nums">{{ formatBaseCurrency(pace.spent) }}</p>
          <div v-if="comparison" class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <i18n-t v-if="hasForecast" keypath="dashboard.widgets.spendingPace.onTrackFor" tag="span">
              <template #amount>
                <b class="font-semibold tabular-nums">~{{ formatWholeBaseCurrency(comparison.forecast) }}</b>
              </template>
            </i18n-t>
            <span
              v-if="comparison.diffPercent !== null"
              :class="cn('rounded-full px-2 py-px text-[11px] font-bold whitespace-nowrap', tone.pill)"
            >
              {{
                $t('dashboard.widgets.spendingPace.vsComparison', {
                  percent: formatPacePercent({ percent: comparison.diffPercent }),
                  name: comparisonName,
                })
              }}
            </span>
          </div>
        </div>

        <dl v-if="stats.length" class="hidden gap-4.5 @lg:flex">
          <div v-for="stat in stats" :key="stat.key" class="flex flex-col items-end">
            <dt class="text-muted-foreground text-[11px]">{{ stat.label }}</dt>
            <dd class="text-[15px] font-bold tabular-nums">{{ stat.value }}</dd>
          </div>
        </dl>
      </div>

      <div class="flex min-h-32 flex-1 flex-col">
        <div
          ref="plotRef"
          class="relative min-h-0 flex-1 touch-pan-y"
          @pointermove="onPointer"
          @pointerdown="onPointer"
          @pointerleave="hoverIndex = null"
        >
          <PacePlot
            :geometry="geometry"
            :width="width"
            :height="height"
            :tone="tone"
            :hover-x="hover?.x"
            :label="$t('dashboard.widgets.spendingPace.chart.ariaLabel')"
          />

          <ChartTooltip
            v-if="hover"
            class="[&_.text-card-tooltip-muted]:text-card-tooltip-foreground pointer-events-none absolute top-0 z-10"
            :style="hover.style"
          >
            <ChartTooltipHeader>
              {{ hover.date
              }}<template v-if="hover.isToday"> · {{ $t('dashboard.widgets.spendingPace.chart.today') }}</template>
            </ChartTooltipHeader>
            <ChartTooltipRow
              v-if="hover.spent !== null"
              :label="$t('dashboard.widgets.spendingPace.tooltip.spent')"
              :value="formatWholeBaseCurrency(hover.spent)"
            />
            <ChartTooltipRow
              v-else-if="hover.forecast !== null"
              :label="$t('dashboard.widgets.spendingPace.tooltip.forecast')"
              :value="`~${formatWholeBaseCurrency(hover.forecast)}`"
            />
            <ChartTooltipRow
              v-if="hover.comparison !== null"
              :label="comparisonName"
              :value="formatWholeBaseCurrency(hover.comparison)"
            />
            <template v-if="spikeBreakdown">
              <ChartTooltipDivider />
              <ChartTooltipSection :label="spikeBreakdown.title" />
              <template v-if="spikeBreakdown.rows">
                <ChartTooltipRow
                  v-for="row in spikeBreakdown.rows"
                  :key="row.id"
                  :label="row.label"
                  :value="row.value"
                  value-class="text-app-expense-color"
                  class="max-w-64"
                />
              </template>
              <template v-else>
                <div v-for="i in 2" :key="i" class="flex justify-between gap-6 py-1.5">
                  <div class="bg-card-tooltip-border h-3 w-28 animate-pulse rounded" />
                  <div class="bg-card-tooltip-border h-3 w-10 animate-pulse rounded" />
                </div>
              </template>
            </template>
          </ChartTooltip>
        </div>

        <div class="text-muted-foreground relative h-3.5 text-[10px]">
          <span
            v-for="tick in axisTicks"
            :key="tick.key"
            :class="cn('absolute whitespace-nowrap', tick.shift, tick.isToday && 'text-foreground font-bold')"
            :style="{ left: tick.left }"
          >
            {{ tick.label }}
          </span>
        </div>
      </div>

      <p v-if="footHint" class="bg-muted text-muted-foreground rounded-lg px-2.5 py-1.5 text-[11px]">{{ footHint }}</p>
      <div v-else class="text-muted-foreground flex flex-wrap gap-x-3.5 gap-y-1 text-[11px]">
        <span class="flex items-center gap-1.25">
          <span class="border-primary w-3.5 border-t-2" />
          {{ $t('dashboard.widgets.spendingPace.legend.thisMonth') }}
        </span>
        <span v-if="hasForecast" class="flex items-center gap-1.25">
          <span :class="cn('w-3.5 border-t-2 border-dotted', tone.border)" />
          {{ $t('dashboard.widgets.spendingPace.legend.forecast') }}
        </span>
        <span class="flex items-center gap-1.25">
          <span class="border-muted-foreground w-3.5 border-t-2 opacity-45" />
          {{ compareMode === 'last' ? comparisonName : $t('dashboard.widgets.spendingPace.legend.averageMonth') }}
        </span>
      </div>
    </div>
  </WidgetWrapper>
</template>
