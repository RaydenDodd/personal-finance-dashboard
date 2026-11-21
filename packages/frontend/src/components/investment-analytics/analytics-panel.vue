<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { SettingsIcon } from '@lucide/vue';
import type {
  InvestmentAnalytics,
  InvestmentFundOverlap,
  InvestmentHistoryPoint,
} from '@bt/shared/types/investment-analytics';
import ExpenseDonut from '@/components/widgets/expenses-structure/donut-chart.vue';
import ModuleBody from '@/components/widgets/components/module-body.vue';
import { CATEGORICAL_SERIES_PALETTE as colors } from '@/composable/charts/categorical-series-palette';
import DateRange from '@/pages/income-management/payroll/date-range.vue';
import { type PayrollRange } from '@/pages/income-management/payroll/date-range';
import { INVESTMENT_ALLOCATION_MODES } from '@/components/widgets/investment-widgets';
import { useChartInteraction } from '@/composable/charts/use-chart-interaction';
import SeriesChart from './series-chart.vue';
import HoldingsTable from './holdings-table.vue';
import Treemap from './treemap.vue';
import OverlapDetails from './overlap-details.vue';
import CompositionHealth from './composition-health.vue';
import { INVESTMENT_PERFORMER_PERIODS, rankInvestmentPerformers } from './performers-model';
import {
  aggregateInvestmentFlows,
  chartNumber,
  withinRange,
  type InvestmentChartPoint,
  type InvestmentChartSeries,
} from './chart-model';
import { investmentRange, investmentRangeSettings } from './date-range';

const props = withDefaults(
  defineProps<{
    analytics: InvestmentAnalytics;
    kind: string;
    settings?: Record<string, unknown>;
    compact?: boolean;
  }>(),
  { settings: () => ({}) },
);
const emit = defineEmits<{ 'settings-change': [patch: Record<string, unknown>] }>();
const containerRef = ref<HTMLElement | null>(null);
const earliest = computed(() =>
  props.kind.startsWith('dividend')
    ? ([...props.analytics.dividends].map((row) => row.date.slice(0, 10)).sort()[0] ??
      props.analytics.coverage.historyStart ??
      props.analytics.generatedAt.slice(0, 10))
    : (props.analytics.coverage.historyStart ?? props.analytics.generatedAt.slice(0, 10)),
);
const initialRange = (): PayrollRange => investmentRange(props.settings, earliest.value);
const range = ref<PayrollRange>(initialRange());
watch([() => props.settings.dateRange, () => props.settings.from, () => props.settings.through, earliest], () => {
  const next = initialRange();
  if (JSON.stringify(range.value) !== JSON.stringify(next)) range.value = next;
});
watch(
  range,
  (value) => {
    emit('settings-change', investmentRangeSettings(value));
  },
  { deep: true },
);
const money = (value: string | number | null | undefined, currency = props.analytics.currencyCode) =>
  value == null
    ? 'Unavailable'
    : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value));
const pct = (value: string | number | null | undefined) =>
  value == null ? 'Unavailable' : `${Number(value).toFixed(2)}%`;
const signed = (value: string | number | null | undefined) =>
  value == null ? 'text-muted-foreground' : Number(value) >= 0 ? 'text-app-income-color' : 'text-app-expense-color';
const metricLabels: Record<string, string> = {
  marketValue: 'Investment value',
  securitiesValue: 'Securities',
  cash: 'Investment cash',
  costBasis: 'Open-position cost basis',
  unrealizedGain: 'Unrealized gain / loss',
  unrealizedPercent: 'Unrealized return',
  realizedGain: 'Realized gain / loss',
  combinedGain: 'Combined investment gains',
  netInvested: 'Net invested capital',
  contributions: 'Historical contributions',
  withdrawals: 'Withdrawals',
  dividends: 'Recorded dividend income',
  interest: 'Recorded interest income',
  fees: 'Investment fees',
  dailyChange: 'Daily market change',
  dailyChangePercent: 'Daily change',
  ytdReturn: 'YTD return',
  lifetimeReturn: 'Lifetime return',
  twr: 'Time-weighted return',
  xirr: 'Money-weighted return (XIRR)',
  annualizedReturn: 'Annualized return',
  volatility: 'Annualized volatility',
  maxDrawdown: 'Maximum drawdown',
  lookThroughCoverage: 'Look-through coverage',
  topFiveConcentration: 'Top five known underlying exposures',
  topTenConcentration: 'Top ten known underlying exposures',
};
const percentMetrics = new Set([
  'unrealizedPercent',
  'dailyChangePercent',
  'ytdReturn',
  'lifetimeReturn',
  'twr',
  'xirr',
  'annualizedReturn',
  'volatility',
  'maxDrawdown',
  'lookThroughCoverage',
  'topFiveConcentration',
  'topTenConcentration',
]);
const metricKeys = computed(() =>
  props.kind === 'gains'
    ? ['unrealizedGain', 'realizedGain', 'combinedGain', 'dividends', 'interest', 'fees', 'costBasis']
    : props.kind === 'risk'
      ? ['volatility', 'maxDrawdown', 'twr', 'annualizedReturn']
      : props.kind === 'concentration'
        ? ['topFiveConcentration', 'topTenConcentration']
        : ['marketValue', 'unrealizedGain', 'netInvested', 'dailyChange'],
);
function displayedMetric(key: string) {
  const full = props.analytics.metrics[key];
  if (key === 'marketValue' && full?.value == null && props.analytics.metrics.knownMarketValue?.value != null)
    return {
      ...props.analytics.metrics.knownMarketValue,
      label: 'Known investment value',
      reason: full?.reason ?? 'Partial subtotal. Some holdings or cash balances are unvalued.',
    };
  return { ...full, label: metricLabels[key] };
}
const secondary = [
  'securitiesValue',
  'cash',
  'costBasis',
  'contributions',
  'withdrawals',
  'realizedGain',
  'combinedGain',
  'dividends',
  'interest',
  'fees',
  'unrealizedPercent',
  'dailyChangePercent',
  'ytdReturn',
  'lifetimeReturn',
  'twr',
  'xirr',
  'annualizedReturn',
];
const showChart = computed(() =>
  ['performance', 'value-capital', 'benchmark', 'dividends', 'contributions', 'portfolio-comparison', 'risk'].includes(
    props.kind,
  ),
);
const percent = computed(
  () =>
    props.kind === 'benchmark' ||
    (props.kind === 'performance' && props.settings.unit === 'percent') ||
    props.kind === 'risk',
);
const defaultSeries = computed(() =>
  props.kind === 'value-capital'
    ? ['marketValue', 'netInvested', 'cumulativeGain']
    : props.kind === 'contributions'
      ? ['contributions', 'withdrawals']
      : props.kind === 'performance'
        ? percent.value
          ? ['returnPercent']
          : ['marketValue']
        : ['returnPercent'],
);
const activeSeries = computed(() =>
  Array.isArray(props.settings.series)
    ? props.settings.series.filter((key): key is string => typeof key === 'string')
    : defaultSeries.value,
);
const historyLabels: Record<string, string> = {
  marketValue: 'Market value',
  netInvested: 'Net invested capital',
  cumulativeGain: 'Cumulative gains',
  unrealizedGain: 'Unrealized gains',
  realizedGain: 'Realized gains',
  returnPercent: 'Investment return',
  contributions: 'Contributions',
  withdrawals: 'Withdrawals',
};
const allHistory = computed(() => withinRange(props.analytics.history, range.value.from, range.value.through));
const selectedIncome = computed(() =>
  props.analytics.dividends.filter(
    (row) =>
      !props.settings.securityId ||
      row.securityId === props.settings.securityId ||
      row.symbol === props.settings.securityId,
  ),
);
const payments = computed(() => withinRange(selectedIncome.value, range.value.from, range.value.through));
const distributionTotals = computed(() => {
  const now = props.analytics.generatedAt.slice(0, 10),
    year = now.slice(0, 4),
    month = now.slice(0, 7);
  const recorded = selectedIncome.value.filter((row) => row.status === 'recorded');
  const completeHistory =
    props.analytics.portfolios.length > 0 && props.analytics.portfolios.every((portfolio) => portfolio.historyComplete);
  return [
    {
      key: 'month',
      label: 'Recorded dividends · month',
      metric: 'dividends',
      rows: recorded.filter((row) => row.type === 'dividend' && row.date.startsWith(month)),
    },
    {
      key: 'ytd',
      label: 'Recorded dividends · YTD',
      metric: 'dividends',
      rows: recorded.filter((row) => row.type === 'dividend' && row.date.startsWith(year)),
    },
    {
      key: 'lifetime',
      label: 'Recorded dividends · lifetime',
      metric: 'dividends',
      rows: recorded.filter((row) => row.type === 'dividend'),
    },
    {
      key: 'interest',
      label: 'Recorded interest',
      metric: 'interest',
      rows: recorded.filter((row) => row.type === 'interest'),
    },
  ].map((total) => {
    const metric = props.analytics.metrics[total.metric];
    const known = metric?.value !== null && metric?.value !== undefined && metric.status !== 'unavailable';
    return {
      key: total.key,
      label: total.label,
      value: known ? total.rows.reduce((sum, row) => sum + Number(row.amount), 0) : null,
      status: !known ? 'unavailable' : completeHistory && metric.status === 'verified' ? 'verified' : 'partial',
      reason: known ? undefined : (metric?.reason ?? 'Income history is unavailable.'),
    };
  });
});
const upcomingPayments = computed(() =>
  selectedIncome.value
    .filter(
      (row) =>
        row.status !== 'recorded' &&
        row.date.slice(0, 10) > props.analytics.generatedAt.slice(0, 10) &&
        (!props.settings.securityId ||
          row.securityId === props.settings.securityId ||
          row.symbol === props.settings.securityId),
    )
    .sort((a, b) => a.date.localeCompare(b.date)),
);
const dividendGrouping = computed(() => (props.settings.dividendGrouping === 'portfolio' ? 'portfolio' : 'security'));
const incomeBreakdown = computed(() => {
  const groups = new Map<
    string,
    { id: string; label: string; name: string; dividends: number | null; interest: number | null; total: number }
  >();
  const known = (key: string) =>
    props.analytics.metrics[key]?.value !== null &&
    props.analytics.metrics[key]?.value !== undefined &&
    props.analytics.metrics[key]?.status !== 'unavailable';
  for (const row of payments.value.filter((row) => row.status === 'recorded')) {
    const id = dividendGrouping.value === 'portfolio' ? row.portfolioId : row.securityId;
    const item = groups.get(id) ?? {
      id,
      label: dividendGrouping.value === 'portfolio' ? row.portfolioName : row.symbol,
      name: dividendGrouping.value === 'portfolio' ? 'Recorded investment income' : row.name,
      dividends: known('dividends') ? 0 : null,
      interest: known('interest') ? 0 : null,
      total: 0,
    };
    const field = row.type === 'dividend' ? 'dividends' : 'interest';
    const current = item[field];
    if (current !== null) item[field] = current + Number(row.amount);
    item.total += Number(row.amount);
    groups.set(id, item);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
});
const dividendGrowth = computed(() => {
  if (!props.analytics.portfolios.length || props.analytics.portfolios.some((row) => !row.historyComplete))
    return {
      value: null,
      reason: 'Comparable dividend growth requires complete transaction history for every selected portfolio.',
    };
  const currentYear = Number(props.analytics.generatedAt.slice(0, 4));
  const years = new Map<number, number>();
  for (const row of selectedIncome.value.filter((row) => row.status === 'recorded' && row.type === 'dividend')) {
    const year = Number(row.date.slice(0, 4));
    if (year < currentYear) years.set(year, (years.get(year) ?? 0) + Number(row.amount));
  }
  const latest = Math.max(...years.keys()),
    previous = years.get(latest - 1),
    current = years.get(latest);
  if (
    previous === undefined ||
    current === undefined ||
    previous <= 0 ||
    !props.analytics.coverage.historyStart ||
    props.analytics.coverage.historyStart > `${latest - 1}-01-01`
  )
    return {
      value: null,
      reason: 'Two complete consecutive calendar years with a positive prior-year dividend total are required.',
    };
  return { value: (current / previous - 1) * 100, reason: `Recorded dividend growth: ${latest - 1} to ${latest}.` };
});
const chartSeries = computed<InvestmentChartSeries[]>(() => {
  if (props.kind === 'dividends')
    return [
      { key: 'cash', label: 'Cash dividends', color: colors[0]! },
      { key: 'reinvested', label: 'Reinvested dividends', color: colors[2]! },
      { key: 'unknown', label: 'Distribution treatment unknown', color: colors[3]! },
      { key: 'interest', label: 'Interest', color: colors[1]! },
    ];
  if (props.kind === 'portfolio-comparison')
    return props.analytics.portfolios.map((row, index) => ({
      key: row.id,
      label: row.name,
      color: colors[index % colors.length]!,
    }));
  if (props.kind === 'benchmark')
    return [
      { key: 'portfolio', label: 'Selected portfolio · cash-flow adjusted', color: colors[0]! },
      ...props.analytics.benchmarks.map((row, index) => ({
        key: row.id,
        label: `${row.symbol} · ${row.returnType}`,
        color: colors[(index + 1) % colors.length]!,
      })),
    ];
  if (props.kind === 'risk')
    return [{ key: 'drawdown', label: 'Drawdown from recorded peak', color: 'var(--app-expense-color)' }];
  return activeSeries.value.map((key, index) => ({
    key,
    label: historyLabels[key] ?? key,
    color: colors[index % colors.length]!,
  }));
});
const chartPoints = computed<InvestmentChartPoint[]>(() => {
  if (props.kind === 'contributions')
    return aggregateInvestmentFlows(allHistory.value, String(props.settings.aggregation ?? 'monthly'));
  if (props.kind === 'dividends') {
    const buckets = new Map<string, InvestmentChartPoint>();
    for (const payment of payments.value.filter((row) => row.status === 'recorded')) {
      const date = payment.date.slice(0, 10),
        month = Number(date.slice(5, 7));
      const key =
        props.settings.aggregation === 'yearly'
          ? date.slice(0, 4) + '-01-01'
          : props.settings.aggregation === 'quarterly'
            ? `${date.slice(0, 4)}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
            : date.slice(0, 7) + '-01';
      const point = buckets.get(key) ?? { date: key, values: { cash: 0, reinvested: 0, unknown: 0, interest: 0 } };
      const series =
        payment.type === 'interest'
          ? 'interest'
          : payment.reinvested === null
            ? 'unknown'
            : payment.reinvested
              ? 'reinvested'
              : 'cash';
      point.values[series] = (point.values[series] ?? 0) + Number(payment.amount);
      buckets.set(key, point);
    }
    return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  if (props.kind === 'benchmark') {
    const series = props.analytics.benchmarks.filter((row) => row.points.length);
    const dates = [
      ...new Set([
        ...allHistory.value.map((row) => row.date),
        ...series.flatMap((row) => row.points.map((point) => point.date)),
      ]),
    ]
      .filter((date) => date >= range.value.from && date <= range.value.through)
      .sort();
    // Comparison starts only at an actual shared observation, with no forward-filled index values.
    const common = dates.find(
      (date) =>
        allHistory.value.some((row) => row.date === date && row.returnPercent !== null) &&
        series.every((row) => row.points.some((point) => point.date === date)),
    );
    if (!common) return [];
    const portfolioBase = chartNumber(allHistory.value.find((row) => row.date === common)?.returnPercent);
    const bases = new Map(
      series.map((row) => [row.id, Number(row.points.find((point) => point.date === common)!.returnPercent)]),
    );
    return dates
      .filter((date) => date >= common)
      .map((date) => ({
        date,
        values: {
          portfolio: rebase(
            chartNumber(allHistory.value.find((row) => row.date === date)?.returnPercent),
            portfolioBase,
          ),
          ...Object.fromEntries(
            series.map((row) => [
              row.id,
              rebase(
                chartNumber(row.points.find((point) => point.date === date)?.returnPercent),
                bases.get(row.id) ?? null,
              ),
            ]),
          ),
        },
        note: 'Normalized at ' + common + '; gaps mean no comparable observation.',
      }));
  }
  if (props.kind === 'risk') {
    let peak = 0;
    return allHistory.value.map((row) => {
      const v = chartNumber(row.returnPercent);
      if (v == null)
        return { date: row.date, values: { drawdown: null }, note: 'Cash-flow-adjusted return unavailable.' };
      const index = 1 + v / 100;
      peak = Math.max(peak, index);
      return { date: row.date, values: { drawdown: peak > 0 ? (index / peak - 1) * 100 : null } };
    });
  }
  return allHistory.value.map((row) => ({
    date: row.date,
    values:
      props.kind === 'portfolio-comparison'
        ? Object.fromEntries(props.analytics.portfolios.map((p) => [p.id, chartNumber(row.portfolios[p.id])]))
        : Object.fromEntries(
            activeSeries.value.map((key) => [key, chartNumber(row[key as keyof InvestmentHistoryPoint])]),
          ),
    note: row.coverage < 100 ? `${row.coverage}% historical coverage · ${row.source}` : row.source,
  }));
});
function rebase(value: number | null, base: number | null) {
  return value === null || base === null || base <= -100 ? null : ((1 + value / 100) / (1 + base / 100) - 1) * 100;
}
const allocationMode = computed(() =>
  String(
    props.settings.allocationMode ??
      (props.kind === 'sector' ? 'sector' : props.kind === 'geography' ? 'country' : 'holdings'),
  ),
);
const allocation = computed(() => props.analytics.allocations[allocationMode.value] ?? []);
const fullAllocationKnown = computed(() => props.analytics.metrics.marketValue?.value != null);
const allocationTotalLabel = computed(() =>
  ['holdings', 'brokerage', 'accountType'].includes(allocationMode.value)
    ? fullAllocationKnown.value
      ? 'Investment allocation'
      : 'Known investment allocation'
    : fullAllocationKnown.value
      ? 'Securities exposure'
      : 'Known securities exposure',
);
const selectedCategory = ref<string | null>(null);
const selectedExposure = ref<string | null>(null);
const overlap = ref<InvestmentFundOverlap | null>(null);
const exposureSearch = ref('');
const isNonCompany = (row: InvestmentAnalytics['exposure'][number]) =>
  !row.unknown &&
  /derivative|cash|money market|commodity|gold|fixed income|repurchase|liabilit|unclassified asset|collateral|crypto|other reported assets/i.test(
    row.assetClass ?? '',
  );
const nonCompany = computed(() => props.analytics.exposure.filter(isNonCompany));
const compositionDates = computed(
  () =>
    props.analytics.coverage.compositionDates ?? [...new Set(props.analytics.fundSnapshots.map((s) => s.asOf))].sort(),
);
useChartInteraction({
  containerRef,
  clear: () => {
    selectedCategory.value = null;
    selectedExposure.value = null;
  },
});
const exposed = computed(() =>
  props.analytics.exposure
    .filter((row) => !isNonCompany(row))
    .filter((row) => `${row.symbol} ${row.name}`.toLowerCase().includes(exposureSearch.value.toLowerCase()))
    .slice(0, Number(props.settings.limit ?? 50)),
);
const selectedAllocation = computed(() => allocation.value.find((row) => row.key === selectedCategory.value));
const contributorRows = computed(() =>
  props.analytics.holdings.filter((row) => selectedAllocation.value?.securityIds.includes(row.securityId)),
);
const funds = computed(() => props.analytics.holdings.filter((row) => row.isFund));
const performerPeriod = computed(() =>
  INVESTMENT_PERFORMER_PERIODS.some(([period]) => period === props.settings.performerPeriod)
    ? String(props.settings.performerPeriod)
    : 'unrealized',
);
const performers = computed(() =>
  rankInvestmentPerformers(props.analytics.holdings, performerPeriod.value, String(props.settings.securityId ?? '')),
);
const performerGroups = computed(() => {
  const filtered = performers.value;
  return [
    { label: 'Best', rows: filtered.slice(0, Number(props.settings.limit ?? 5)) },
    { label: 'Worst', rows: [...filtered].reverse().slice(0, Number(props.settings.limit ?? 5)) },
  ];
});
const largest = computed(() =>
  [...props.analytics.holdings]
    .sort((a, b) => Number(b.marketValue ?? 0) - Number(a.marketValue ?? 0))
    .slice(0, Number(props.settings.limit ?? 10)),
);
const healthFilter = ref('all');
const health = computed(() =>
  props.analytics.health.filter((row) => healthFilter.value === 'all' || row.status === healthFilter.value),
);
</script>
<template>
  <div
    ref="containerRef"
    class="@container flex min-h-0 min-w-0 flex-col gap-3"
    :data-testid="'investment-panel-' + kind"
  >
    <template v-if="['overview', 'gains', 'risk', 'concentration'].includes(kind)">
      <div class="grid grid-cols-2 gap-x-5 gap-y-4" :class="!compact && kind === 'overview' ? '@3xl:grid-cols-4' : ''">
        <div v-for="key in metricKeys" :key="key">
          <p class="text-muted-foreground text-xs">{{ displayedMetric(key).label }}</p>
          <p
            class="mt-1 text-xl font-semibold tracking-tight tabular-nums"
            :class="
              key.toLowerCase().includes('gain') || key === 'dailyChange' ? signed(analytics.metrics[key]?.value) : ''
            "
          >
            {{ percentMetrics.has(key) ? pct(displayedMetric(key).value) : money(displayedMetric(key).value) }}
          </p>
          <p v-if="displayedMetric(key).reason" class="text-muted-foreground mt-1 text-[11px]">
            {{ displayedMetric(key).reason }}
          </p>
          <span v-else-if="analytics.metrics[key]?.status !== 'verified'" class="text-muted-foreground text-[10px]">{{
            analytics.metrics[key]?.status ?? 'unavailable'
          }}</span>
        </div>
      </div>
      <details v-if="kind === 'overview'" class="border-t pt-3">
        <summary class="text-primary-text cursor-pointer text-xs">Income, cost basis and return details</summary>
        <dl class="mt-3 grid grid-cols-2 gap-3 @2xl:grid-cols-3">
          <div v-for="key in secondary" :key="key">
            <dt class="text-muted-foreground text-xs">{{ metricLabels[key] }}</dt>
            <dd class="font-medium tabular-nums" :title="analytics.metrics[key]?.reason">
              {{ percentMetrics.has(key) ? pct(analytics.metrics[key]?.value) : money(analytics.metrics[key]?.value) }}
            </dd>
            <p v-if="analytics.metrics[key]?.reason" class="text-muted-foreground text-[10px]">
              {{ analytics.metrics[key].reason }}
            </p>
          </div>
        </dl>
      </details>
    </template>
    <p v-if="kind === 'concentration'" class="text-muted-foreground text-xs">
      Dated fund composition coverage {{ pct(analytics.coverage.lookThroughPercent) }} · effective dates
      {{ compositionDates.join(', ') || 'unavailable' }}. Cash, commodities and derivatives are excluded from company
      concentration.
    </p>
    <template v-if="showChart">
      <DateRange v-model="range" :earliest="earliest" :compact="compact" subject="investment">
        <template #actions
          ><Popover v-if="kind === 'performance'"
            ><PopoverTrigger as-child
              ><Button size="icon" variant="ghost" class="size-7" aria-label="Investment chart settings"
                ><SettingsIcon class="size-3.5" /></Button></PopoverTrigger
            ><PopoverContent align="end" class="w-64"
              ><label class="mb-2 block text-xs"
                >Display<select
                  :value="settings.unit ?? 'dollars'"
                  class="bg-background mt-1 w-full rounded border p-2"
                  @change="
                    emit('settings-change', { unit: ($event.target as HTMLSelectElement).value, series: undefined })
                  "
                >
                  <option value="dollars">Dollars</option>
                  <option value="percent">Cash-flow-adjusted return %</option>
                </select></label
              ><label v-for="(label, key) in historyLabels" :key="key" class="flex items-center gap-2 py-1 text-xs"
                ><input
                  type="checkbox"
                  :checked="activeSeries.includes(String(key))"
                  :disabled="percent ? key !== 'returnPercent' : key === 'returnPercent'"
                  @change="
                    emit('settings-change', {
                      series: activeSeries.includes(String(key))
                        ? activeSeries.filter((id) => id !== key)
                        : [...activeSeries, String(key)],
                    })
                  "
                />{{ label }}</label
              ></PopoverContent
            ></Popover
          ></template
        >
      </DateRange>
      <template v-if="kind === 'dividends'"
        ><div class="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
          <div
            v-for="total in distributionTotals"
            :key="total.key"
            :data-testid="'investment-income-summary-' + total.key"
          >
            <p class="text-muted-foreground text-xs">{{ total.label }}</p>
            <p class="text-lg font-semibold">{{ money(total.value) }}</p>
            <p v-if="total.status === 'partial'" class="text-muted-foreground text-[10px]">
              Recorded subtotal · partial history
            </p>
            <p v-if="total.reason" class="text-muted-foreground text-[10px]">{{ total.reason }}</p>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <label class="text-muted-foreground text-xs"
            >Aggregation<select
              :value="settings.aggregation ?? 'monthly'"
              aria-label="Dividend aggregation"
              class="bg-background ml-2 rounded border px-2 py-1"
              @change="emit('settings-change', { aggregation: ($event.target as HTMLSelectElement).value })"
            >
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select></label
          ><label class="text-muted-foreground text-xs"
            >Security<select
              :value="settings.securityId ?? ''"
              aria-label="Dividend security filter"
              class="bg-background ml-2 max-w-40 rounded border px-2 py-1"
              @change="emit('settings-change', { securityId: ($event.target as HTMLSelectElement).value })"
            >
              <option value="">All securities</option>
              <option v-for="holding in analytics.holdings" :key="holding.id" :value="holding.securityId">
                {{ holding.symbol }}
              </option>
            </select></label
          >
        </div></template
      >
      <label v-if="kind === 'contributions'" class="text-muted-foreground flex flex-wrap items-center gap-2 text-xs"
        >Aggregation<select
          :value="settings.aggregation ?? 'monthly'"
          aria-label="Contribution aggregation"
          class="bg-background rounded-md border px-2 py-1.5"
          @change="emit('settings-change', { aggregation: ($event.target as HTMLSelectElement).value })"
        >
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="yearly">Yearly</option>
        </select></label
      >
      <SeriesChart
        :points="chartPoints"
        :series="chartSeries"
        :compact="compact"
        :percent="percent && kind !== 'portfolio-comparison'"
        :bars="kind === 'dividends' || kind === 'contributions'"
        :share-label="kind === 'contributions' ? 'absolute period flows' : 'period income'"
        :events="
          withinRange(analytics.events, range.from, range.through).map((row) => ({ date: row.date, label: row.label }))
        "
        :label="kind === 'dividends' ? 'Recorded investment income history' : 'Consolidated investment ' + kind"
      />
      <p v-if="kind === 'benchmark'" class="text-muted-foreground text-xs">
        Returns share an actual common starting observation. Price-only benchmarks exclude distributions. A portfolio
        without supported cash-flow-adjusted returns cannot be compared.
      </p>
      <p
        v-for="benchmark in kind === 'benchmark' ? analytics.benchmarks : []"
        :key="benchmark.id"
        class="text-muted-foreground text-xs"
      >
        {{ benchmark.symbol }} · {{ benchmark.status }} · {{ benchmark.reason ?? benchmark.returnType }}
      </p>
      <p v-if="kind === 'portfolio-comparison'" class="text-muted-foreground text-xs">
        Recorded portfolio values in {{ analytics.currencyCode }}. Cash flows affect balances; these are not comparable
        investment returns.
      </p>
      <p v-if="kind === 'performance' || kind === 'value-capital'" class="text-muted-foreground text-xs">
        Only dated recorded valuations and supported historical prices are used. Gaps indicate unavailable observations.
        Contributions and withdrawals are separate from investment gains.
      </p>
      <p v-if="kind === 'contributions'" class="text-muted-foreground text-xs">
        {{
          analytics.metrics.contributions?.status !== 'verified' ||
          analytics.metrics.contributions?.value == null ||
          !analytics.portfolios.length ||
          analytics.portfolios.some((portfolio) => !portfolio.historyComplete)
            ? 'Recorded external flows; imported funding history may be incomplete.'
            : 'Recorded external flows; transfers within the selected portfolio group are excluded.'
        }}
      </p>
      <details
        v-if="kind === 'dividends'"
        :open="!compact"
        class="border-t pt-3"
        data-testid="investment-income-breakdown"
      >
        <summary class="text-primary-text cursor-pointer text-xs">Recorded income by security or portfolio</summary>
        <div class="mt-3 flex flex-wrap gap-1" role="group" aria-label="Investment income breakdown grouping">
          <Button
            size="sm"
            :variant="dividendGrouping === 'security' ? 'secondary' : 'ghost'"
            :aria-pressed="dividendGrouping === 'security'"
            @click="emit('settings-change', { dividendGrouping: 'security' })"
            >By security</Button
          >
          <Button
            size="sm"
            :variant="dividendGrouping === 'portfolio' ? 'secondary' : 'ghost'"
            :aria-pressed="dividendGrouping === 'portfolio'"
            @click="emit('settings-change', { dividendGrouping: 'portfolio' })"
            >By portfolio</Button
          >
        </div>
        <p class="text-muted-foreground mt-2 text-[11px]">
          Recorded subtotals only; partial imported history may omit earlier dividends or interest.
        </p>
        <ModuleBody
          ><div
            v-for="row in incomeBreakdown"
            :key="row.id"
            class="flex items-start justify-between gap-3 border-b py-2 text-xs last:border-0"
          >
            <span class="min-w-0"
              ><strong>{{ row.label }}</strong
              ><span class="text-muted-foreground block truncate">{{ row.name }}</span></span
            ><span class="shrink-0 text-right"
              ><strong>{{ money(row.total) }}</strong
              ><span class="text-muted-foreground block text-[10px]">Recorded subtotal</span
              ><span class="text-muted-foreground block"
                >Dividends {{ money(row.dividends) }} ·
                <span :data-testid="'investment-income-breakdown-interest-' + row.id"
                  >interest {{ money(row.interest) }}</span
                ></span
              ></span
            >
          </div>
          <p v-if="!incomeBreakdown.length" class="text-muted-foreground py-3 text-xs">
            No recorded investment income matches this period and security filter.
          </p></ModuleBody
        >
        <p class="text-muted-foreground mt-3 text-xs">
          <span class="font-medium">Dividend growth: {{ pct(dividendGrowth.value) }}.</span> {{ dividendGrowth.reason }}
        </p>
      </details>
      <p v-if="kind === 'dividends'" class="text-muted-foreground text-xs">
        Recorded income only; incomplete transaction history may omit earlier payments. Current indicated yield, yield
        on cost, dividend growth and forecasts require reliable distribution schedules and complete basis; unavailable
        estimates are not invented.
      </p>
      <p v-if="kind === 'risk'" class="text-muted-foreground text-xs">
        Drawdown uses supported cash-flow-adjusted returns. Missing return history keeps risk unavailable; balance
        changes are not substituted.
      </p>
    </template>
    <template v-if="['allocation', 'sector', 'geography'].includes(kind)">
      <label class="text-muted-foreground flex flex-wrap items-center gap-2 text-xs"
        >Allocation by<select
          :value="allocationMode"
          aria-label="Investment allocation mode"
          class="bg-background max-w-full rounded-md border px-2 py-1.5 text-xs"
          @change="
            selectedCategory = null;
            emit('settings-change', { allocationMode: ($event.target as HTMLSelectElement).value });
          "
        >
          <option v-for="[id, label] in INVESTMENT_ALLOCATION_MODES" :key="id" :value="id">{{ label }}</option>
        </select></label
      >
      <ExpenseDonut
        :data="
          allocation
            .filter((row) => Number(row.value) > 0)
            .map((row, index) => ({
              categoryId: row.key,
              name: row.label,
              amount: Number(row.value),
              color: colors[index % colors.length]!,
            }))
        "
        :total-amount="allocation.reduce((sum, row) => sum + Number(row.value), 0)"
        :total-label="allocationTotalLabel"
        chart-label="Investment allocation doughnut"
        :height-class="compact ? 'h-48' : 'h-64'"
        :show-percentages="fullAllocationKnown"
        selection-mode="highlight"
        :highlight-category-id="selectedCategory"
        @category-click="({ categoryId }) => (selectedCategory = categoryId)"
      />
      <ModuleBody
        ><div class="grid gap-1 @2xl:grid-cols-2">
          <button
            v-for="(row, index) in allocation"
            :key="row.key"
            type="button"
            class="hover:bg-accent flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs"
            :class="selectedCategory === row.key ? 'bg-accent' : ''"
            :aria-pressed="selectedCategory === row.key"
            @click="selectedCategory = selectedCategory === row.key ? null : row.key"
          >
            <span class="flex min-w-0 items-center gap-2"
              ><span class="size-2 shrink-0 rounded-full" :style="{ background: colors[index % colors.length] }" /><span
                class="truncate"
                >{{ row.label }}</span
              ></span
            ><span class="shrink-0 tabular-nums">{{ money(row.value) }} · {{ pct(row.percent) }}</span>
          </button>
        </div></ModuleBody
      >
      <div v-if="selectedAllocation" class="bg-muted/40 rounded-md p-3 text-xs">
        <p class="mb-2 font-medium">{{ selectedAllocation.label }} contributors</p>
        <p v-for="row in contributorRows" :key="row.id" class="flex justify-between gap-2 py-1">
          <span>{{ row.symbol }} · {{ row.name }}</span
          ><span>{{ money(row.marketValue) }}</span>
        </p>
        <p v-if="!contributorRows.length">
          {{
            selectedAllocation.securityIds.length
              ? 'Underlying holdings are economic exposures; see the company exposure table for fund contributions.'
              : 'No classified constituent detail is available.'
          }}
        </p>
      </div>
      <p v-if="!fullAllocationKnown" class="text-muted-foreground text-xs">
        Only known values are drawn; unvalued cash or positions prevent a complete portfolio total. Slice proportions
        describe this known subtotal. Portfolio percentages remain unavailable.
      </p>
      <p v-if="!allocation.length" class="text-muted-foreground text-sm">
        Classification data is unavailable for this mode.
      </p>
      <details class="text-xs">
        <summary class="text-primary-text cursor-pointer">Historical allocation availability</summary>
        <p class="text-muted-foreground mt-2">
          Historical allocation changes require dated position valuations and fund compositions for each observation.
          This selection has no complete historical composition series. Current fund weights are never applied to past
          dates.
        </p>
      </details>
      <p
        v-if="!['holdings', 'brokerage', 'accountType'].includes(allocationMode)"
        class="text-muted-foreground text-xs"
      >
        Issuer-country methodology; fund listing location and domicile do not establish company geography. Unknown
        amounts remain in the total. Fund composition coverage {{ pct(analytics.coverage.lookThroughPercent) }}.
        Effective dates: {{ compositionDates.join(', ') || 'No dated compositions' }}. Positive exposures form the
        doughnut; signed derivatives and liabilities remain in the accompanying values.
      </p>
    </template>
    <HoldingsTable
      v-if="kind === 'holdings'"
      :analytics="analytics"
      :compact="compact"
      :limit="Number(settings.limit ?? 20)"
      :security-id="String(settings.securityId ?? '')"
    />
    <Treemap v-if="kind === 'heatmap'" :analytics="analytics" :settings="settings" :compact="compact" />
    <template v-if="kind === 'exposure'"
      ><p class="text-muted-foreground text-xs">
        Direct plus indirect company exposure · fund composition coverage
        {{ pct(analytics.coverage.lookThroughPercent) }}. Partial holdings are not normalized to 100%. Effective dates:
        {{ compositionDates.join(', ') || 'No dated compositions' }}.
      </p>
      <input
        v-model="exposureSearch"
        aria-label="Search underlying companies"
        placeholder="Search companies"
        class="bg-background h-8 rounded-md border px-3 text-sm"
      /><ModuleBody
        ><div v-for="row in exposed" :key="row.id" class="border-b py-2 last:border-0">
          <button
            type="button"
            class="flex w-full items-center justify-between gap-3 text-left text-xs"
            :aria-expanded="selectedExposure === row.id"
            @click="selectedExposure = selectedExposure === row.id ? null : row.id"
          >
            <span class="min-w-0"
              ><strong>{{ row.symbol }}</strong> · {{ row.name
              }}<span class="text-muted-foreground block"
                >{{ row.sector ?? 'Unknown sector' }} · {{ row.industry ?? 'Unknown industry' }} ·
                {{ row.country ?? 'Unknown issuer country' }}</span
              ></span
            ><span class="shrink-0 text-right"
              ><strong>{{ money(row.totalValue) }} · {{ pct(row.weight) }}</strong
              ><span class="text-muted-foreground block"
                >Direct {{ money(row.directValue) }} · indirect {{ money(row.indirectValue) }}</span
              ><span class="text-muted-foreground block"
                >{{ row.fundCount }} funds · {{ row.sourceDate ?? 'Source date unavailable' }}</span
              ></span
            >
          </button>
          <div v-if="selectedExposure === row.id" class="bg-muted/40 mt-2 rounded-md p-3 text-xs">
            <p v-for="(source, index) in row.contributions" :key="index" class="mb-2">
              {{ source.fundSymbol ?? 'Direct position' }} · {{ source.portfolioName }} · {{ money(source.value)
              }}<span class="text-muted-foreground block"
                >Fund weight {{ source.weight == null ? 'Unknown' : pct(source.weight) }} · {{ source.source }} ·
                {{ source.asOf ?? 'Date unavailable' }}</span
              >
            </p>
            <p v-if="row.unknown">Unidentified or unavailable fund weights are preserved as Unknown.</p>
          </div>
        </div>
        <p v-if="!exposed.length" class="text-muted-foreground py-4 text-sm">
          No underlying company data is available for this selection.
        </p></ModuleBody
      >
      <details
        v-if="nonCompany.length"
        :open="!compact"
        class="border-t pt-3 text-xs"
        data-testid="investment-noncompany-exposure"
      >
        <summary class="text-primary-text cursor-pointer">
          Gold, cash, derivatives and other non-company balances
        </summary>
        <ModuleBody
          ><div v-for="row in nonCompany" :key="row.id" class="flex items-start justify-between gap-3 border-b py-2">
            <span class="min-w-0"
              ><strong>{{ row.symbol }}</strong> · {{ row.name
              }}<span class="text-muted-foreground block">{{ row.assetClass }} · {{ row.sourceDate }}</span
              ><span v-if="row.notionalWeight" class="text-muted-foreground block"
                >Reported notional weight {{ pct(row.notionalWeight) }} of its source fund; separate from market
                value.</span
              ></span
            ><span class="shrink-0 text-right">{{ money(row.totalValue) }} · {{ pct(row.weight) }}</span>
          </div></ModuleBody
        >
      </details>
    </template>
    <template v-if="kind === 'overlap'"
      ><p class="text-muted-foreground text-xs">
        Weighted overlap is the sum of minimum comparable company weights. Select a fund pair to inspect shared
        companies.
      </p>
      <div class="overflow-auto">
        <table class="w-full text-xs" data-testid="investment-overlap-matrix">
          <thead>
            <tr>
              <th class="p-2 text-left">Funds</th>
              <th v-for="fund in funds" :key="fund.id" class="p-2">{{ fund.symbol }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="left in funds" :key="left.id">
              <th class="p-2 text-left">{{ left.symbol }}</th>
              <td v-for="right in funds" :key="right.id" class="p-1 text-center">
                <span v-if="left.id === right.id" class="text-muted-foreground">—</span
                ><button
                  v-else
                  type="button"
                  class="hover:bg-accent w-full rounded-md border p-2"
                  :aria-label="'Overlap ' + left.symbol + ' and ' + right.symbol"
                  @click="
                    overlap =
                      analytics.overlap.find(
                        (row) =>
                          (row.leftId === left.securityId && row.rightId === right.securityId) ||
                          (row.rightId === left.securityId && row.leftId === right.securityId),
                      ) ?? null
                  "
                >
                  {{
                    pct(
                      analytics.overlap.find(
                        (row) =>
                          (row.leftId === left.securityId && row.rightId === right.securityId) ||
                          (row.rightId === left.securityId && row.leftId === right.securityId),
                      )?.weightedOverlap,
                    )
                  }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="overlap" class="bg-muted/40 rounded-md p-3 text-xs">
        <OverlapDetails :pair="overlap" :currency-code="analytics.currencyCode" />
        <Button size="sm" variant="ghost" class="mt-2" @click="overlap = null">Close details</Button>
      </div>
      <p v-if="funds.length < 2" class="text-muted-foreground text-sm">
        Select at least two held funds to compare overlap.
      </p></template
    >
    <template v-if="kind === 'dividend-calendar'"
      ><DateRange v-model="range" :earliest="earliest" :compact="compact" subject="investment" /><ModuleBody
        ><div
          v-for="row in payments"
          :key="row.id"
          class="flex items-center justify-between gap-3 border-b py-3 text-xs last:border-0"
        >
          <span
            ><time class="block font-medium">{{ row.date.slice(0, 10) }}</time
            ><span class="text-muted-foreground">{{ row.symbol }} · {{ row.portfolioName }}</span></span
          ><span class="text-right"
            ><strong>{{ money(row.amount, row.currencyCode) }}</strong
            ><span class="text-muted-foreground block"
              >{{ row.status }} · {{ row.type }} ·
              {{ row.reinvested === null ? 'Treatment unknown' : row.reinvested ? 'Reinvested' : 'Cash' }}</span
            ></span
          >
        </div>
        <p v-if="!payments.length" class="text-muted-foreground py-4 text-sm">
          No recorded or announced payments in this period.
        </p></ModuleBody
      >
      <div class="border-t pt-3" data-testid="investment-upcoming-dividends">
        <h4 class="text-xs font-semibold">Upcoming distributions</h4>
        <ModuleBody
          ><div
            v-for="row in upcomingPayments"
            :key="row.id"
            class="flex items-center justify-between gap-3 border-b py-3 text-xs last:border-0"
          >
            <span
              ><time class="block font-medium">{{ row.date.slice(0, 10) }}</time
              ><span class="text-muted-foreground">{{ row.symbol }} · {{ row.portfolioName }}</span></span
            ><span class="text-right"
              ><strong>{{ money(row.amount, row.currencyCode) }}</strong
              ><span class="text-muted-foreground block">{{
                row.status === 'announced' ? 'Announced payment' : 'Estimated payment · not guaranteed'
              }}</span></span
            >
          </div>
          <p v-if="!upcomingPayments.length" class="text-muted-foreground py-3 text-xs">
            No announced or supported estimated payment schedule is available.
          </p></ModuleBody
        >
      </div>
      <p class="text-muted-foreground text-xs">
        Upcoming payments require announced source dates. Forecasts are estimates; recorded dividends are never
        duplicated as contributions.
      </p></template
    >
    <template v-if="kind === 'performers'"
      ><label class="text-muted-foreground flex flex-wrap items-center gap-2 text-xs"
        >Rank by<select
          :value="performerPeriod"
          aria-label="Performer return period"
          class="bg-background max-w-full rounded-md border px-2 py-1.5"
          @change="emit('settings-change', { performerPeriod: ($event.target as HTMLSelectElement).value })"
        >
          <option v-for="[id, label] in INVESTMENT_PERFORMER_PERIODS" :key="id" :value="id">{{ label }}</option>
        </select></label
      >
      <p class="text-muted-foreground text-xs">
        {{
          performerPeriod === 'unrealized'
            ? 'Open-position unrealized return uses reliable remaining cost basis and valuation.'
            : 'Security price-only changes use dated recorded prices through the latest supported quote; distributions and cash flows are excluded. These are not total investment returns.'
        }}
        Missing or stale observations are excluded from ranking.
      </p>
      <div class="grid grid-cols-2 gap-4">
        <div v-for="group in performerGroups" :key="group.label">
          <p class="mb-2 text-xs font-medium">{{ group.label }}</p>
          <div
            v-for="row in group.rows"
            :key="row.id"
            class="flex justify-between gap-2 border-b py-2 text-xs"
            data-testid="investment-performer-row"
            :data-symbol="row.symbol"
          >
            <span>{{ row.symbol }}</span
            ><span :class="signed(row.returnValue)">{{ pct(row.returnValue) }}</span>
          </div>
        </div>
      </div>
      <p v-if="!performers.length" class="text-muted-foreground text-sm">
        No securities have reliable observations for this selected return period.
      </p></template
    >
    <template v-if="kind === 'concentration'"
      ><ModuleBody
        ><div v-for="row in largest" :key="row.id" class="py-2 text-xs">
          <div class="flex justify-between gap-2">
            <span>{{ row.symbol }} · {{ row.name }}</span
            ><span>{{ pct(row.weight) }}</span>
          </div>
          <div class="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
            <div class="bg-primary h-full" :style="{ width: Math.min(Number(row.weight ?? 0), 100) + '%' }" />
          </div></div
      ></ModuleBody>
      <p class="text-muted-foreground text-xs">
        Bars show direct holdings; top-five and top-ten metrics use known underlying economic exposure. Missing fund
        weights limit those metrics. Descriptive analytics do not predict losses.
      </p></template
    >
    <template v-if="kind === 'health'"
      ><div class="grid grid-cols-3 gap-2">
        <div
          v-for="[label, value] in [
            ['Prices', analytics.coverage.pricePercent],
            ['Cost basis', analytics.coverage.costBasisPercent],
            ['Look-through', analytics.coverage.lookThroughPercent],
          ]"
          :key="label"
        >
          <p class="text-muted-foreground text-xs">{{ label }}</p>
          <p class="text-lg font-semibold">{{ pct(value) }}</p>
        </div>
      </div>
      <p class="text-muted-foreground text-xs">
        {{ analytics.refresh.provider }} · last successful refresh
        {{ analytics.refresh.lastSuccess ?? 'unavailable' }} · {{ analytics.refresh.schedule }}
      </p>
      <label class="text-xs"
        >Show<select
          v-model="healthFilter"
          aria-label="Investment data quality filter"
          class="bg-background ml-2 rounded border px-2 py-1"
        >
          <option value="all">All data checks</option>
          <option value="verified">Verified</option>
          <option value="partial">Partial</option>
          <option value="stale">Stale</option>
          <option value="unavailable">Unavailable</option>
        </select></label
      ><ModuleBody
        ><details v-for="row in health" :key="row.id" class="border-b py-2 text-xs last:border-0">
          <summary class="flex cursor-pointer items-center justify-between gap-3">
            <span>{{ row.label }}</span
            ><span class="text-muted-foreground">{{ row.status }}</span>
          </summary>
          <p class="text-muted-foreground mt-2">
            {{ row.detail }}<span v-if="row.asOf"> · {{ row.asOf }}</span>
          </p>
        </details></ModuleBody
      >
      <details>
        <summary class="text-primary-text cursor-pointer text-xs">Calculation and coverage methodology</summary>
        <p v-for="method in analytics.coverage.methodology" :key="method" class="text-muted-foreground mt-2 text-xs">
          {{ method }}
        </p>
      </details></template
    >
    <CompositionHealth
      v-if="
        analytics.composition?.length &&
        ['health', 'allocation', 'sector', 'geography', 'exposure', 'overlap'].includes(kind)
      "
      :rows="analytics.composition"
      :compact="compact"
    />
  </div>
</template>
