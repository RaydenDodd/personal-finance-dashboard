<script setup lang="ts">
import type { DashboardWidgetConfig } from '@/api/user-settings';
import { Button } from '@/components/lib/ui/button';
import AnalyticsPanel from '@/components/investment-analytics/analytics-panel.vue';
import { useInvestmentAnalytics } from '@/composable/data-queries/investment-analytics';
import { usePortfolios } from '@/composable/data-queries/portfolios';
import { ArrowUpRightIcon } from '@lucide/vue';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { computed, inject, provide, ref, type Ref } from 'vue';
import ErrorState from './components/error-state.vue';
import LoadingState from './components/loading-state.vue';
import WidgetWrapper from './components/widget-wrapper.vue';
import InvestmentWidgetSettings from './investment-widget-settings.vue';
import { INVESTMENT_WIDGET_DEFINITIONS, investmentWidgetKind, investmentWidgetSettings } from './investment-widgets';

const widget = inject<Ref<DashboardWidgetConfig>>('dashboard-widget-config')!;
const persist =
  inject<(args: { widgetId: string; config: Record<string, unknown> }) => Promise<unknown>>(
    'dashboard-save-widget-config',
  );
const kind = computed(() => investmentWidgetKind(widget.value.widgetId) ?? 'overview');
const definition = computed(() => INVESTMENT_WIDGET_DEFINITIONS[widget.value.widgetId]);
const optimisticSettings = ref<Record<string, unknown>>({});
const pageSettings = inject<Ref<Record<string, unknown>> | null>('investment-page-settings', null);
const fullPage = inject('investment-full-page', false);
provide(
  'investment-chart-height',
  computed(() => {
    const base = fullPage ? 288 : 208;
    return base + Math.max(0, (widget.value.rowSpan ?? 1) - 1) * 180;
  }),
);
const settings = computed(() =>
  investmentWidgetSettings(kind.value, { ...pageSettings?.value, ...widget.value.config, ...optimisticSettings.value }),
);
const portfolioIds = computed(() => settings.value.portfolioIds);
const benchmarks = computed(() => (kind.value === 'benchmark' ? settings.value.benchmarks : []));
const performanceFrom = computed(() =>
  ['heatmap', 'performers'].includes(kind.value) && settings.value.from ? String(settings.value.from) : undefined,
);
const performanceThrough = computed(() =>
  performanceFrom.value && settings.value.through ? String(settings.value.through) : undefined,
);
const { data, isPending, isFetching, error, refetch } = useInvestmentAnalytics({
  portfolioIds,
  benchmarks,
  performanceFrom,
  performanceThrough,
});
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
        await persist({ widgetId: widget.value.instanceId ?? widget.value.widgetId, config: next });
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
  <WidgetWrapper :is-fetching="isFetching" :data-investment-widget="kind">
    <template #title>{{ definition?.name ?? 'Investment analytics' }}</template>
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
    <ScrollArea
      class="min-h-0 min-w-0 flex-1"
      viewport-class="[&>div]:!block"
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
      <p v-if="saveError && !settingsOpen" class="text-destructive mt-2 text-xs" role="alert">{{ saveError }}</p>
    </ScrollArea>
  </WidgetWrapper>
</template>
