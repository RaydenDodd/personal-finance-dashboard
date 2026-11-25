<script setup lang="ts">
import { format, parseISO } from 'date-fns';
import { computeTrendPeriods } from './cash-flow-widget/helpers';
import { useMediaQuery, useResizeObserver } from '@vueuse/core';
import { useDashboardPeriod } from './composables/use-dashboard-period';
import { useModuleLayout } from './composables/use-module-layout';
import type { DashboardWidgetConfig } from '@/api/user-settings';
import { Button } from '@/components/lib/ui/button';
import { payrollToday } from '@/pages/income-management/payroll/date-range';
import { usesCustomPositionPeriod } from '@/components/investment-analytics/performers-model';
import { investmentRange } from '@/components/investment-analytics/date-range';
import AnalyticsPanel from '@/components/investment-analytics/analytics-panel.vue';
import { investmentSectionForWidget } from '@bt/shared/types/investment-analytics-read';
import { useInvestmentAnalytics } from '@/composable/data-queries/investment-analytics';
import { useInvestmentHistory } from '@/composable/data-queries/investment-history';
import { usePortfolios } from '@/composable/data-queries/portfolios';
import { ArrowUpRightIcon } from '@lucide/vue';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { computed, inject, provide, ref, unref, type Ref } from 'vue';
import ErrorState from './components/error-state.vue';
import LoadingState from './components/loading-state.vue';
import WidgetWrapper from './components/widget-wrapper.vue';
import WidgetHeaderControls from './components/widget-header-controls.vue';
import InvestmentWidgetSettings from './investment-widget-settings.vue';
import { INVESTMENT_WIDGET_DEFINITIONS, investmentWidgetKind, investmentWidgetSettings } from './investment-widgets';

const { dashboardRange } = useDashboardPeriod();
const mobileHeader = useMediaQuery('(max-width: 639px)');
const { bounded } = useModuleLayout();
const widget = inject<Ref<DashboardWidgetConfig>>('dashboard-widget-config')!;
const persist =
  inject<(args: { widgetId: string; config: Record<string, unknown> }) => Promise<unknown>>(
    'dashboard-save-widget-config',
  );
const kind = computed(() => investmentWidgetKind(widget.value.widgetId) ?? 'overview');
const hasPeriodControls = computed(
  () => Boolean(dashboardRange.value) && ['performance', 'portfolio-comparison', 'heatmap'].includes(kind.value),
);
const definition = computed(() => INVESTMENT_WIDGET_DEFINITIONS[widget.value.widgetId]);
const defaultCurrentDay = inject<Ref<boolean> | boolean>('investment-default-current-day', false);
const optimisticSettings = ref<Record<string, unknown>>(
  unref(defaultCurrentDay) && ['performance', 'heatmap'].includes(kind.value)
    ? {
        dateRange: '1D',
        from: payrollToday(),
        through: payrollToday(),
        colorBy: 'daily',
      }
    : {},
);
const pageSettings = inject<Ref<Record<string, unknown>> | null>('investment-page-settings', null);
const fullPage = inject('investment-full-page', false);
const bodyRef = ref<InstanceType<typeof ScrollArea> | HTMLDivElement | null>(null);
const availableHeight = ref(0);
useResizeObserver(bodyRef, (entries) => {
  if (bounded.value) availableHeight.value = entries[0]?.contentRect.height ?? 0;
});
provide(
  'investment-chart-height',
  computed(() => {
    if (bounded.value && availableHeight.value > 100 && kind.value !== 'heatmap')
      return Math.max(
        140,
        availableHeight.value -
          (kind.value === 'risk' || kind.value === 'contributions' ? 160 : kind.value === 'performance' ? 24 : 46),
      );
    const base = kind.value === 'heatmap' ? (fullPage ? 380 : 340) : fullPage ? 288 : 208;
    return base + Math.max(0, (fullPage || bounded.value ? (widget.value.rowSpan ?? 1) : 1) - 1) * 180;
  }),
);
const settings = computed(() =>
  investmentWidgetSettings(kind.value, {
    ...pageSettings?.value,
    ...widget.value.config,
    ...optimisticSettings.value,
    ...(dashboardRange.value
      ? {
          dateRange: 'custom',
          from: ['contributions', 'dividends'].includes(kind.value)
            ? format(
                computeTrendPeriods({
                  from: parseISO(dashboardRange.value.from),
                  to: parseISO(dashboardRange.value.through),
                })[0].from,
                'yyyy-MM-dd',
              )
            : dashboardRange.value.from,
          through: dashboardRange.value.through,
          aggregation: 'monthly',
          colorBy: 'custom',
          performerPeriod: 'custom',
        }
      : {}),
    ...(dashboardRange.value &&
    ['performance', 'portfolio-comparison', 'heatmap'].includes(kind.value) &&
    ['today', 'month'].includes(
      String(optimisticSettings.value.dashboardPeriod ?? widget.value.config?.dashboardPeriod),
    )
      ? (optimisticSettings.value.dashboardPeriod ?? widget.value.config?.dashboardPeriod) === 'month'
        ? {
            dateRange: '1M',
            from: payrollToday().slice(0, 7) + '-01',
            through: payrollToday(),
            colorBy: 'custom',
          }
        : {
            dateRange: '1D',
            from: payrollToday(),
            through: payrollToday(),
            colorBy: 'daily',
          }
      : {}),
    ...(kind.value === 'performance'
      ? {
          portfolioIds: [],
          breakdown: 'combined',
          ...(dashboardRange.value ? { unit: 'dollars', series: undefined } : {}),
        }
      : {}),
  }),
);
const portfolioIds = computed(() => settings.value.portfolioIds);
const sharedBenchmarks = inject<Ref<string[]> | null>('investment-shared-benchmarks', null);
const benchmarks = computed(
  () => sharedBenchmarks?.value ?? (kind.value === 'benchmark' ? settings.value.benchmarks : []),
);
const positionPeriod = computed(() => kind.value === 'heatmap'
  ? String(settings.value.colorBy ?? 'daily')
  : String(settings.value.performerPeriod ?? 'daily'));
const performanceFrom = computed(() =>
  ['heatmap', 'performers'].includes(kind.value) &&
  !(kind.value === 'heatmap' && settings.value.holdingsMode === 'underlying') &&
  usesCustomPositionPeriod(settings.value, positionPeriod.value)
    ? String(settings.value.from)
    : undefined,
);
const performanceThrough = computed(() =>
  performanceFrom.value && settings.value.through
    ? [String(settings.value.through), payrollToday()].sort()[0]
    : undefined,
);
const focusedHistory = computed(() => ['performance', 'value-capital', 'portfolio-comparison'].includes(kind.value));
const broad = useInvestmentAnalytics({
  portfolioIds,
  benchmarks: () => kind.value === 'benchmark' ? benchmarks.value : [],
  performanceFrom: () => ['heatmap', 'performers'].includes(kind.value) ? performanceFrom.value : undefined,
  performanceThrough: () => ['heatmap', 'performers'].includes(kind.value) ? performanceThrough.value : undefined,
  section: () => kind.value === 'heatmap' && settings.value.holdingsMode === 'underlying' ? 'exposure' : investmentSectionForWidget(kind.value),
  enabled: () => !focusedHistory.value,
});
const narrow = useInvestmentHistory({
  portfolioIds,
  enabled: () => focusedHistory.value || kind.value === 'benchmark',
  includeCapital: () => ['performance', 'portfolio-comparison', 'value-capital', 'benchmark'].includes(kind.value),
  gainFrom: () => investmentRange(settings.value, '1900-01-01').from,
  includeEvents: () => Boolean(settings.value.showEvents),
});
const data = computed(() =>
  focusedHistory.value
    ? narrow.data.value
    : kind.value === 'benchmark' && broad.data.value && narrow.data.value?.accountHistory
      ? {
          ...broad.data.value,
          accountHistory: narrow.data.value.accountHistory,
        }
      : broad.data.value,
);
const isPending = computed(() => (focusedHistory.value ? narrow.isPending.value : broad.isPending.value));
const isFetching = computed(() => (focusedHistory.value ? narrow.isFetching.value : broad.isFetching.value));
const error = computed(() => (focusedHistory.value ? narrow.error.value : broad.error.value));
const refetch = () => (focusedHistory.value ? narrow.refetch() : broad.refetch());
const { data: portfolios } = usePortfolios();
const settingsOpen = ref(false);
const saving = ref(false);
const saveError = ref('');
const pageByKind: Record<string, string> = {
  performance: 'performance',
  'value-capital': 'performance',
  benchmark: 'performance',
  holdings: 'holdings',
  performers: 'holdings',
  dividends: 'dividends',
  'dividend-calendar': 'dividends',
  allocation: 'allocation',
  heatmap: 'allocation',
  exposure: 'allocation',
  sector: 'allocation',
  geography: 'allocation',
  overlap: 'allocation',
  'portfolio-comparison': 'performance',
};
const page = computed(() => pageByKind[kind.value] ?? 'overview');

let queuedSettings: Record<string, unknown> | null = null;
let closeAfterSave = false;
const saveSettings = async (patch: Record<string, unknown>, close = false) => {
  if (!persist) return;
  if (dashboardRange.value) {
    patch = Object.fromEntries(
      Object.entries(patch).filter(
        ([key]) => !['dateRange', 'from', 'through', 'colorBy', 'performerPeriod'].includes(key),
      ),
    );
    if (!Object.keys(patch).length) return;
  }
  // Keep rapid period/legend changes visible while the preceding save is in flight.
  // The next request contains the latest value of every queued setting.
  optimisticSettings.value = { ...optimisticSettings.value, ...patch };
  queuedSettings = { ...queuedSettings, ...patch };
  closeAfterSave ||= close;
  if (saving.value) return;
  saving.value = true;
  saveError.value = '';
  try {
    while (queuedSettings) {
      const next = queuedSettings;
      queuedSettings = null;
      try {
        await persist({
          widgetId: widget.value.instanceId ?? widget.value.widgetId,
          config: next,
        });
        for (const [key, value] of Object.entries(next)) {
          if (JSON.stringify(optimisticSettings.value[key]) === JSON.stringify(value))
            delete optimisticSettings.value[key];
        }
      } catch {
        // Retain failed and subsequent changes for the next explicit retry.
        queuedSettings = { ...next, ...(queuedSettings ?? {}) };
        saveError.value = 'Settings could not be saved. Try again.';
        return;
      }
    }
    if (closeAfterSave) settingsOpen.value = false;
    closeAfterSave = false;
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <WidgetWrapper
    :is-fetching="isFetching"
    :data-investment-widget="kind"
    :compact-header="hasPeriodControls && mobileHeader"
  >
    <template #title
      >{{ definition?.name ?? 'Investment analytics'
      }}<span
        v-if="
          dashboardRange &&
          [
            'allocation',
            'sector',
            'geography',
            'holdings',
            'exposure',
            'concentration',
            'gains',
            'overlap',
            'overview',
            'health',
          ].includes(kind)
        "
        class="text-muted-foreground text-xs font-normal"
      >
        &middot; current</span
      ></template
    >
    <template #action>
      <Button as-child variant="ghost" size="icon-sm" aria-label="Open Investments page"
        ><router-link :to="`/finances/investments/${page}`"
          ><ArrowUpRightIcon class="text-muted-foreground size-4" /></router-link
      ></Button>
      <InvestmentWidgetSettings
        v-model:open="settingsOpen"
        :kind="kind"
        :settings="settings"
        :portfolios="portfolios ?? []"
        :saving="saving"
        :save-error="saveError"
        @save="saveSettings($event, true)"
      />
    </template>
    <component :is="mobileHeader ? WidgetHeaderControls : 'div'" :class="mobileHeader ? '' : 'mb-2'">
      <div
        v-if="hasPeriodControls"
        class="bg-muted/60 inline-flex shrink-0 gap-0.5 rounded-lg p-0.5"
        data-chart-controls
        role="group"
        aria-label="Widget period"
      >
        <Button
          v-for="[value, label] in [
            ['today', '1D'],
            ['month', '1M'],
          ]"
          :key="value"
          size="sm"
          class="h-7 px-2 text-xs"
          :variant="(settings.dashboardPeriod === 'today' ? 'today' : 'month') === value ? 'secondary' : 'ghost'"
          :aria-pressed="(settings.dashboardPeriod === 'today' ? 'today' : 'month') === value"
          @click="saveSettings({ dashboardPeriod: value })"
          >{{ label }}</Button
        >
      </div>
    </component>
    <component
      ref="bodyRef"
      :is="bounded ? ScrollArea : 'div'"
      :class="bounded ? 'min-h-0 min-w-0 flex-1' : 'min-w-0'"
      viewport-class="pr-2 [&>div]:!block"
      :data-investment-instance="widget.instanceId ?? widget.widgetId"
    >
      <LoadingState v-if="isPending" />
      <ErrorState v-else-if="error" message="Investment analytics could not be loaded." @retry="refetch()" />
      <AnalyticsPanel
        v-else-if="data"
        :analytics="data"
        :kind="kind"
        :settings="settings"
        :compact="!fullPage"
        @settings-change="saveSettings($event)"
      />
      <p v-else class="text-muted-foreground p-4 text-sm">
        Investment analytics are unavailable. Check your portfolio records and data sources in Investments.
      </p>
      <p v-if="saveError && !settingsOpen" class="text-destructive mt-2 text-xs" role="alert">
        {{ saveError }}
      </p>
    </component>
  </WidgetWrapper>
</template>
