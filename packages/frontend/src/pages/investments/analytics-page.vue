<script setup lang="ts">
import { computed, ref } from 'vue';
import { useLocalStorage } from '@vueuse/core';
import PageWrapper from '@/components/common/page-wrapper.vue';
import { Button } from '@/components/lib/ui/button';
import { Card, CardHeader, CardContent } from '@/components/lib/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { RefreshCwIcon, FileInputIcon, FilterIcon } from '@lucide/vue';
import AnalyticsPanel from '@/components/investment-analytics/analytics-panel.vue';
import FundImport from '@/components/investment-analytics/fund-import.vue';
import InvestmentSettings from '@/components/widgets/investment-widget-settings.vue';
import { INVESTMENT_WIDGETS, type InvestmentWidgetKind } from '@/components/widgets/investment-widgets';
import { useInvestmentAnalytics } from '@/composable/data-queries/investment-analytics';
import { refreshInvestmentPrices } from '@/api/investment-analytics';

const props = defineProps<{ page: 'overview' | 'performance' | 'holdings' | 'allocation' | 'dividends' }>();
const settings = useLocalStorage<Record<string, unknown>>('investments:analytics:settings', {
  portfolioIds: [],
  benchmarks: ['SPY'],
  dateRange: '1Y',
  aggregation: 'monthly',
  allocationMode: 'holdings',
  sizeBy: 'marketValue',
  colorBy: 'unrealized',
  grouping: 'security',
  holdingsMode: 'direct',
});
const panelSettings = useLocalStorage<Record<string, Record<string, unknown>>>('investments:analytics:panels', {});
const settingsOpen = ref(false),
  importOpen = ref(false),
  refreshing = ref(false),
  refreshError = ref(''),
  groupFilter = ref('all'),
  brokerFilter = ref('all');
const all = useInvestmentAnalytics();
const portfolioIds = computed(() => {
  const ids = Array.isArray(settings.value.portfolioIds) ? (settings.value.portfolioIds as string[]) : [];
  const candidates = all.data.value?.portfolios ?? [];
  if (groupFilter.value === 'all' && brokerFilter.value === 'all') return ids;
  return candidates
    .filter(
      (p) =>
        (!ids.length || ids.includes(p.id)) &&
        (groupFilter.value === 'all' || p.accountType === groupFilter.value) &&
        (brokerFilter.value === 'all' || p.broker === brokerFilter.value),
    )
    .map((p) => p.id);
});
const noMatches = computed(() =>
  Boolean(
    all.data.value && (groupFilter.value !== 'all' || brokerFilter.value !== 'all') && !portfolioIds.value.length,
  ),
);
const query = useInvestmentAnalytics({
  portfolioIds,
  benchmarks: () => (props.page === 'performance' ? ((settings.value.benchmarks as string[]) ?? []) : []),
  enabled: () => !noMatches.value,
});
const titles = {
  overview: 'Overview',
  performance: 'Performance',
  holdings: 'Holdings',
  allocation: 'Allocation & Exposure',
  dividends: 'Dividends',
};
const subtitles = {
  overview: 'Your investments across every selected account.',
  performance: 'Recorded values, investment returns and market comparisons.',
  holdings: 'Combined positions with account-level cost basis and valuation.',
  allocation: 'Understand direct holdings and the companies inside your funds.',
  dividends: 'Recorded dividends, interest and distribution history.',
};
const kinds = computed<InvestmentWidgetKind[]>(() =>
  props.page === 'overview'
    ? ['overview', 'value-capital', 'concentration', 'health']
    : props.page === 'performance'
      ? ['performance', 'benchmark', 'contributions', 'gains', 'risk', 'portfolio-comparison']
      : props.page === 'holdings'
        ? ['holdings', 'heatmap', 'performers']
        : props.page === 'allocation'
          ? ['allocation', 'exposure', 'overlap']
          : ['dividends', 'dividend-calendar'],
);
const brokers = computed(() => [...new Set((all.data.value?.portfolios ?? []).map((p) => p.broker))]);
const groups = computed(() => [...new Set((all.data.value?.portfolios ?? []).map((p) => p.accountType))]);
const titleFor = (kind: string) => INVESTMENT_WIDGETS.find(([id]) => id === kind)?.[1] ?? kind;
function patchSettings(patch: Record<string, unknown>) {
  if (['dateRange', 'from', 'through'].some((key) => patch[key] !== settings.value[key])) {
    panelSettings.value = Object.fromEntries(
      Object.entries(panelSettings.value).map(([kind, value]) => {
        const { dateRange: _range, from: _from, through: _through, ...rest } = value;
        return [kind, rest];
      }),
    );
  }
  settings.value = { ...settings.value, ...patch };
  settingsOpen.value = false;
}
function patchPanel(kind: string, patch: Record<string, unknown>) {
  panelSettings.value = { ...panelSettings.value, [kind]: { ...panelSettings.value[kind], ...patch } };
}
const effectiveSettings = (kind: string) => ({ ...settings.value, ...panelSettings.value[kind] });
async function refresh() {
  refreshError.value = '';
  refreshing.value = true;
  try {
    await refreshInvestmentPrices();
    await all.refetch();
    await query.refetch();
  } catch (cause) {
    refreshError.value =
      cause instanceof Error ? cause.message : 'Price refresh failed. Your existing observations are preserved.';
  } finally {
    refreshing.value = false;
  }
}
</script>
<template>
  <PageWrapper
    ><div class="mx-auto w-full max-w-7xl space-y-4" :data-testid="'investments-' + page + '-page'">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-muted-foreground text-xs">Investments</p>
          <h1 class="mt-0.5 text-2xl font-semibold">{{ titles[page] }}</h1>
          <p class="text-muted-foreground mt-1 text-sm">{{ subtitles[page] }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-1">
          <Button v-if="page === 'allocation'" variant="outline" size="sm" @click="importOpen = true"
            ><FileInputIcon class="mr-1.5 size-3.5" />Import fund holdings</Button
          ><Button
            variant="ghost"
            size="icon"
            aria-label="Refresh investment market prices"
            :disabled="refreshing"
            @click="refresh"
            ><RefreshCwIcon class="size-4" :class="refreshing ? 'animate-spin' : ''" /></Button
          ><Popover
            ><PopoverTrigger as-child
              ><Button variant="ghost" size="icon" aria-label="Investment account group filters"
                ><FilterIcon class="size-4" /></Button></PopoverTrigger
            ><PopoverContent align="end" class="w-64"
              ><label class="mb-3 block text-xs"
                >Brokerage<select
                  v-model="brokerFilter"
                  aria-label="Investment brokerage filter"
                  class="bg-background mt-1 w-full rounded-md border p-2"
                >
                  <option value="all">All institutions</option>
                  <option v-for="broker in brokers" :key="broker" :value="broker">{{ broker }}</option>
                </select></label
              ><label class="block text-xs"
                >Account group<select
                  v-model="groupFilter"
                  aria-label="Investment account group"
                  class="bg-background mt-1 w-full rounded-md border p-2"
                >
                  <option value="all">All account types</option>
                  <option v-for="group in groups" :key="group" :value="group">{{ group }}</option>
                </select></label
              ></PopoverContent
            ></Popover
          ><InvestmentSettings
            v-model:open="settingsOpen"
            :kind="
              page === 'performance'
                ? 'benchmark'
                : page === 'holdings'
                  ? 'heatmap'
                  : page === 'allocation'
                    ? 'allocation'
                    : page === 'dividends'
                      ? 'dividends'
                      : 'overview'
            "
            :settings="settings"
            :portfolios="all.data.value?.portfolios ?? []"
            title="Investment filters and settings"
            @save="patchSettings"
          />
        </div>
      </header>
      <div class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span>{{ portfolioIds.length ? portfolioIds.length + ' selected portfolios' : 'All portfolios' }}</span
        ><span v-if="groupFilter !== 'all'">{{ groupFilter }}</span
        ><span v-if="brokerFilter !== 'all'">{{ brokerFilter }}</span
        ><span v-if="query.data.value?.refresh.lastSuccess"
          >Prices updated {{ query.data.value.refresh.lastSuccess }}</span
        ><span v-if="query.data.value">{{ query.data.value.currencyCode }} reporting currency</span>
      </div>
      <p v-if="refreshError" role="alert" class="text-app-expense-color rounded-md border p-3 text-sm">
        {{ refreshError }}
      </p>
      <div v-if="query.isError.value" role="alert" class="rounded-md border p-4 text-sm">
        Investment analytics could not be loaded.<Button variant="ghost" size="sm" @click="query.refetch()"
          >Try again</Button
        >
      </div>
      <p v-else-if="noMatches" class="text-muted-foreground rounded-md border p-6 text-sm">
        No portfolios match these account filters. Change the selected group or institution.
      </p>
      <p v-else-if="query.isPending.value" class="text-muted-foreground p-8 text-center text-sm" role="status">
        Loading consolidated investments…
      </p>
      <template v-else-if="query.data.value"
        ><div class="grid grid-cols-1 items-start gap-4" :class="page === 'overview' ? 'xl:grid-cols-2' : ''">
          <Card
            v-for="kind in kinds"
            :key="kind"
            class="min-w-0 overflow-hidden"
            :class="kind === 'overview' || kind === 'value-capital' ? 'xl:col-span-2' : ''"
            ><CardHeader class="py-4"
              ><h2 class="text-base font-semibold">{{ titleFor(kind) }}</h2></CardHeader
            ><CardContent
              ><AnalyticsPanel
                :analytics="query.data.value"
                :kind="kind"
                :settings="effectiveSettings(kind)"
                @settings-change="patchPanel(kind, $event)" /></CardContent
          ></Card></div
      ></template>
      <FundImport
        v-if="query.data.value"
        v-model="importOpen"
        :funds="query.data.value.holdings.filter((row) => row.isFund)"
        :securities="query.data.value.holdings"
        @saved="
          query.refetch();
          all.refetch();
        "
      /></div
  ></PageWrapper>
</template>
