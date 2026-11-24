<script setup lang="ts">
import WidgetHeaderControls from '@/components/widgets/components/widget-header-controls.vue';
import { useDashboardPeriod } from '@/components/widgets/composables/use-dashboard-period';
import { computed, inject, ref, watch } from 'vue';
import { Button } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { SettingsIcon } from '@lucide/vue';
import type {
  InvestmentAnalytics,
  InvestmentFundOverlap,
  InvestmentHistoryPoint,
} from '@bt/shared/types/investment-analytics';
import DrilldownDonut from '@/components/common/charts/drilldown-donut.vue';
import { allocationDrilldown } from './allocation-drilldown';
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
import MetricBreakdown from './metric-breakdown.vue';
import HistoryCoverage from './history-coverage.vue';
import { INVESTMENT_PERFORMER_PERIODS, rankInvestmentPerformers, usesCustomPositionPeriod } from './performers-model';
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
const emit = defineEmits<{
  'settings-change': [patch: Record<string, unknown>];
}>();
const containerRef = ref<HTMLElement | null>(null);
const { dashboardRange } = useDashboardPeriod();
const inlineInformation = !inject('investment-full-page', false);
const showInformation = ref(false);
const activeMetric = ref<string | null>(null);
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
  value == null
    ? 'Unavailable'
    : Number(value) < 100 && Number(value) > 99.99
      ? '<100%'
      : `${Number(value).toFixed(2)}%`;
const signed = (value: string | number | null | undefined) =>
  value == null ? 'text-muted-foreground' : Number(value) >= 0 ? 'text-app-income-color' : 'text-app-expense-color';
const metricLabels: Record<string, string> = {
  marketValue: 'Investment value',
  securitiesValue: 'Securities',
  cash: 'Investment cash',
  costBasis: 'Open-position cost basis',
  unrealizedGain: 'Unrealized gain / loss',
  accountGain: 'Total account gain',
  unrealizedPercent: 'Unrealized return',
  realizedGain: 'Realized gain / loss',
  combinedGain: 'Combined investment gains',
  netInvested: 'Reconciled net principal',
  contributions: 'Imported cash deposits',
  withdrawals: 'Withdrawals',
  dividends: 'Recorded dividend income',
  interest: 'Recorded interest income',
  fees: 'Investment fees',
  dailyChange: 'Daily account change',
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
    ? ['accountGain', 'unrealizedGain', 'realizedGain', 'combinedGain', 'dividends', 'interest', 'fees', 'costBasis']
    : props.kind === 'risk'
      ? ['volatility', 'maxDrawdown', 'twr', 'annualizedReturn']
      : props.kind === 'concentration'
        ? ['topFiveConcentration', 'topTenConcentration']
        : ['marketValue', 'accountGain', 'unrealizedGain', 'dailyChange'],
);
function displayedMetric(key: string) {
  const full = props.analytics.metrics[key];
  if (props.kind === 'risk' && full?.value == null && props.analytics.priceRisk?.points.length) {
    const value =
      key === 'volatility'
        ? props.analytics.priceRisk.volatility
        : key === 'maxDrawdown'
          ? props.analytics.priceRisk.maxDrawdown
          : null;
    if (value !== null)
      return {
        value,
        status: 'partial',
        label: key === 'volatility' ? 'Current holdings · price volatility' : 'Current holdings · price drawdown',
        reason: props.analytics.priceRisk.methodology,
      };
  }
  if (key === 'marketValue' && full?.value == null && props.analytics.metrics.knownMarketValue?.value != null)
    return {
      ...props.analytics.metrics.knownMarketValue,
      label: 'Known investment value',
      reason: full?.reason ?? 'Partial subtotal. Some holdings or cash balances are unvalued.',
    };
  if (full?.value == null) {
    const fallback = (
      {
        costBasis: ['knownCostBasis', 'Known open-position basis'],
        unrealizedGain: ['knownUnrealizedGain', 'Known unrealized gain / loss'],
        realizedGain: ['reportedRealizedGain', 'Broker-reported realized gains'],
        netInvested: ['knownNetInvested', 'Recorded net funding'],
      } as Record<string, string[]>
    )[key];
    const partial = fallback && props.analytics.metrics[fallback[0]!];
    if (partial?.value != null) return { ...partial, label: fallback![1] };
  }
  return { ...full, label: metricLabels[key] };
}
const secondary = [
  'netInvested',
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
  knownNetInvested: 'Recorded net funding · partial history',
  withdrawals: 'Withdrawals',
};
const allHistory = computed(() => withinRange(props.analytics.history, range.value.from, range.value.through));
const recordedAccountFallback = computed(
  () =>
    ['performance', 'value-capital'].includes(props.kind) &&
    props.kind !== 'performance' &&
    props.settings.breakdown === 'accounts',
);
const recordedPortfolios = computed(() =>
  props.analytics.portfolios.filter((p) =>
    allHistory.value.some((row) => Number(row.knownPortfolios?.[p.id] ?? row.portfolios[p.id] ?? 0) > 0),
  ),
);
const priceRiskFallback = computed(
  () =>
    !(props.kind === 'benchmark' && props.analytics.accountHistory) &&
    !allHistory.value.some((row) => row.returnPercent !== null) &&
    Boolean(props.analytics.priceRisk?.points.length),
);
const comparablePortfolioPoints = computed(() =>
  props.kind === 'benchmark' && props.analytics.accountHistory
    ? props.analytics.accountHistory.dates.flatMap((date, i) => {
        const value = props.analytics.accountHistory!.periodReturnPercent?.[i];
        return value == null || date.slice(0, 10) < range.value.from || date.slice(0, 10) > range.value.through
          ? []
          : [{ date, returnPercent: value }];
      })
    : priceRiskFallback.value
      ? withinRange(props.analytics.priceRisk?.points ?? [], range.value.from, range.value.through)
      : allHistory.value
          .filter((row) => row.returnPercent !== null)
          .map((row) => ({ date: row.date, returnPercent: row.returnPercent! })),
);
const selectedIncome = computed(() =>
  props.analytics.dividends.filter(
    (row) =>
      !props.settings.securityId ||
      row.securityId === props.settings.securityId ||
      row.symbol === props.settings.securityId,
  ),
);
const payments = computed(() => withinRange(selectedIncome.value, range.value.from, range.value.through));
const dividendDay = ref<string | null>(null);
const calendarMonth = ref('');
watch(
  () => range.value.through,
  (date) => {
    calendarMonth.value = date.slice(0, 7);
    dividendDay.value = null;
  },
  { immediate: true },
);
const calendarCells = computed(() => {
  const first = new Date(calendarMonth.value + '-01T12:00:00Z');
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return [
    ...Array.from({ length: first.getUTCDay() }, () => null),
    ...Array.from({ length: count }, (_, i) => {
      const date = calendarMonth.value + '-' + String(i + 1).padStart(2, '0');
      const rows = selectedIncome.value.filter((row) => row.date.slice(0, 10) === date && row.type === 'dividend');
      return { date, day: i + 1, count: rows.length, amount: rows.reduce((sum, row) => sum + Number(row.amount), 0) };
    }),
  ];
});
const selectedDividendPayments = computed(() =>
  payments.value.filter((row) => !dividendDay.value || row.date.slice(0, 10) === dividendDay.value),
);
function moveDividendMonth(delta: number) {
  const date = new Date(calendarMonth.value + '-01T12:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + delta);
  calendarMonth.value = date.toISOString().slice(0, 7);
  dividendDay.value = null;
}

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
    {
      id: string;
      label: string;
      name: string;
      dividends: number | null;
      interest: number | null;
      total: number;
    }
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
  return {
    value: (current / previous - 1) * 100,
    reason: `Recorded dividend growth: ${latest - 1} to ${latest}.`,
  };
});
const gainView = computed(
  () => props.kind === 'performance' && props.settings.unit !== 'dollars' && props.settings.unit !== undefined,
);
const gainLabel = computed(() => (percent.value ? 'Portfolio return' : 'Portfolio gain / loss'));
const performanceSummary = computed(() => {
  const h = props.analytics.accountHistory;
  if (!h?.dates) return null;
  const i = h.dates.findLastIndex(
    (date, i) => date >= range.value.from && date <= range.value.through && h.periodGains?.[i] != null,
  );
  return i < 0 ? null : { gain: h.periodGains?.[i], percent: h.periodReturnPercent?.[i] };
});
const chartSeries = computed<InvestmentChartSeries[]>(() => {
  if (gainView.value)
    return recordedAccountFallback.value
      ? props.analytics.portfolios.map((p, i) => ({
          key: p.id,
          label: p.name,
          color: colors[i % colors.length]!,
        }))
      : [{ key: 'gain', label: gainLabel.value, color: colors[0]! }];
  if (
    props.analytics.accountHistory &&
    !recordedAccountFallback.value &&
    ['performance', 'value-capital'].includes(props.kind)
  )
    return [
      {
        key: 'marketValue',
        label: 'Combined investment value',
        color: colors[0]!,
      },
      ...(props.kind === 'value-capital'
        ? [
            {
              key: 'knownNetInvested',
              label: 'Recorded net funding',
              color: colors[3]!,
            },
          ]
        : []),
    ];
  if (props.kind === 'dividends')
    return [
      { key: 'cash', label: 'Cash dividends', color: colors[0]! },
      { key: 'reinvested', label: 'Reinvested dividends', color: colors[2]! },
      {
        key: 'unknown',
        label: 'Distribution treatment unknown',
        color: colors[3]!,
      },
      { key: 'interest', label: 'Interest', color: colors[1]! },
    ];
  if (props.kind === 'portfolio-comparison' || recordedAccountFallback.value)
    return [
      ...recordedPortfolios.value.map((row, index) => ({
        key: row.id,
        label: row.name,
        color: colors[index % colors.length]!,
      })),
      ...(props.kind === 'value-capital' && allHistory.value.some((p) => p.knownNetInvested != null)
        ? [
            {
              key: 'knownNetInvested',
              label: historyLabels.knownNetInvested!,
              color: colors[3]!,
            },
          ]
        : []),
    ];
  if (props.kind === 'benchmark')
    return [
      {
        key: 'portfolio',
        label: props.analytics.accountHistory
          ? 'Portfolio - estimated return'
          : priceRiskFallback.value
            ? 'Current holdings · price only'
            : 'Selected portfolio · cash-flow adjusted',
        color: colors[0]!,
      },
      ...props.analytics.benchmarks.map((row, index) => ({
        key: row.id,
        label: `${row.symbol} · ${row.returnType}`,
        color: colors[(index + 1) % colors.length]!,
      })),
    ];
  if (props.kind === 'risk')
    return [
      {
        key: 'drawdown',
        label: priceRiskFallback.value ? 'Current holdings · price drawdown' : 'Drawdown from recorded peak',
        color: 'var(--app-expense-color)',
      },
    ];
  if (props.kind === 'performance' && percent.value && priceRiskFallback.value)
    return [
      {
        key: 'returnPercent',
        label: 'Current holdings · price only',
        color: colors[0]!,
      },
    ];
  if (props.kind === 'contributions')
    return [
      { key: 'contributions', label: 'Contributions', color: colors[0]! },
      { key: 'withdrawals', label: 'Withdrawals', color: colors[1]! },
      { key: 'netContributions', label: 'Net invested', color: '#e6bf27' },
      { key: 'previousAverage', label: 'Previous six periods average', color: '#a1a1aa' },
    ];
  return activeSeries.value.map((key, index) => ({
    key,
    label: historyLabels[key] ?? key,
    color: colors[index % colors.length]!,
  }));
});
const chartPoints = computed<InvestmentChartPoint[]>(() => {
  if (gainView.value) {
    const history = props.analytics.accountHistory;
    const period = true;
    if (history)
      return history.dates.flatMap((date, i) =>
        date.slice(0, 10) < range.value.from || date.slice(0, 10) > range.value.through
          ? []
          : [
              {
                date,
                values: recordedAccountFallback.value
                  ? Object.fromEntries(
                      history.accounts.map((p) => [
                        p.id,
                        chartNumber((percent.value ? p.periodReturnPercent : p.periodGains)?.[i]),
                      ]),
                    )
                  : {
                      gain: chartNumber((percent.value ? history.periodReturnPercent : history.periodGains)?.[i]),
                    },
                note: percent.value
                  ? 'Estimated return weighted by dated external cash flows (Modified Dietz).'
                  : undefined,
              },
            ],
      );
    return allHistory.value.map((row) => ({
      date: row.date,
      values: { gain: period ? null : chartNumber(row.cumulativeGain) },
    }));
  }
  if (
    props.analytics.accountHistory &&
    !recordedAccountFallback.value &&
    ['performance', 'value-capital'].includes(props.kind)
  )
    return allHistory.value.map((row) => ({
      date: row.date,
      values: {
        marketValue: chartNumber(row.marketValue ?? row.knownMarketValue),
        ...(props.kind === 'value-capital' ? { knownNetInvested: chartNumber(row.knownNetInvested) } : {}),
      },
      note: row.coverage < 100 ? row.source : undefined,
    }));
  if (props.kind === 'contributions') {
    const points = aggregateInvestmentFlows(allHistory.value, String(props.settings.aggregation ?? 'monthly'));
    return points.map((point, i) => {
      const prior = points.slice(Math.max(0, i - 6), i);
      const net = (p: InvestmentChartPoint) => (p.values.contributions ?? 0) + (p.values.withdrawals ?? 0);
      return {
        ...point,
        values: {
          ...point.values,
          netContributions: net(point),
          previousAverage: prior.length ? prior.reduce((sum, p) => sum + net(p), 0) / prior.length : null,
        },
      };
    });
  }
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
      const point = buckets.get(key) ?? {
        date: key,
        values: { cash: 0, reinvested: 0, unknown: 0, interest: 0 },
      };
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
        ...comparablePortfolioPoints.value.map((row) => row.date),
        ...series.flatMap((row) => row.points.map((point) => point.date)),
      ]),
    ]
      .filter((date) => date >= range.value.from && date <= range.value.through)
      .sort();
    // Comparison starts only at an actual shared observation, with no forward-filled index values.
    const common = dates.find((date) => series.every((row) => row.points.some((point) => point.date === date)));
    if (!common) return [];
    const portfolioBase = chartNumber(comparablePortfolioPoints.value.find((row) => row.date >= common)?.returnPercent);
    const bases = new Map(
      series.map((row) => [row.id, Number(row.points.find((point) => point.date === common)!.returnPercent)]),
    );
    return dates
      .filter((date) => date >= common)
      .map((date) => ({
        date,
        values: {
          portfolio: rebase(
            chartNumber(comparablePortfolioPoints.value.find((row) => row.date === date)?.returnPercent),
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
        note: 'Compared from ' + common,
      }));
  }
  if (props.kind === 'risk') {
    let peak = 0;
    return (priceRiskFallback.value ? comparablePortfolioPoints.value : allHistory.value).map((row) => {
      const v = chartNumber(row.returnPercent);
      if (v == null)
        return {
          date: row.date,
          values: { drawdown: null },
          note: 'Missing funding history',
        };
      const index = 1 + v / 100;
      peak = Math.max(peak, index);
      return {
        date: row.date,
        values: { drawdown: peak > 0 ? (index / peak - 1) * 100 : null },
      };
    });
  }
  if (props.kind === 'performance' && percent.value && priceRiskFallback.value) {
    const base = chartNumber(comparablePortfolioPoints.value[0]?.returnPercent);
    return comparablePortfolioPoints.value.map((row) => ({
      date: row.date,
      values: { returnPercent: rebase(chartNumber(row.returnPercent), base) },
      note: `Current holdings · price only · ${pct(props.analytics.priceRisk!.coveragePercent)} coverage`,
    }));
  }
  return allHistory.value.map((row) => ({
    date: row.date,
    values:
      props.kind === 'portfolio-comparison' || recordedAccountFallback.value
        ? Object.fromEntries([
            ...recordedPortfolios.value.map((p) => [
              p.id,
              chartNumber(row.portfolios[p.id] ?? row.knownPortfolios?.[p.id]),
            ]),
            ...(props.kind === 'value-capital' ? [['knownNetInvested', chartNumber(row.knownNetInvested)]] : []),
          ])
        : Object.fromEntries(
            activeSeries.value.map((key) => [key, chartNumber(row[key as keyof InvestmentHistoryPoint])]),
          ),
    note: row.coverage < 100 ? 'Partial recorded value' : undefined,
  }));
});
const plottedPoints = computed(() => {
  const points = chartPoints.value,
    valid = (p: InvestmentChartPoint) => Object.values(p.values).some((v) => v !== null);
  const first = points.findIndex(valid),
    last = points.findLastIndex(valid);
  return first < 0 ? [] : points.slice(first, last + 1);
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
const allocationTree = computed(() => allocationDrilldown(props.analytics, allocationMode.value));
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
const nonCompanyTotal = computed(
  () =>
    props.analytics.metrics.nonCompanyValue?.value ??
    nonCompany.value.reduce((sum, row) => sum + Number(row.totalValue), 0),
);
const overlapStrength = (left: string, right: string) => {
  const value = Number(
    props.analytics.overlap.find(
      (row) => (row.leftId === left && row.rightId === right) || (row.leftId === right && row.rightId === left),
    )?.weightedOverlap ?? 0,
  );
  return {
    backgroundColor: `color-mix(in srgb, var(--primary) ${Math.min(32, Math.max(0, value) * 0.32)}%, transparent)`,
  };
};
const compositionDates = computed(
  () =>
    props.analytics.coverage.compositionDates ?? [...new Set(props.analytics.fundSnapshots.map((s) => s.asOf))].sort(),
);
useChartInteraction({
  containerRef,
  clear: () => {
    selectedCategory.value = null;
  },
});
const exposed = computed(() =>
  props.analytics.exposure
    .filter((row) => !isNonCompany(row))
    .filter((row) => `${row.symbol} ${row.name}`.toLowerCase().includes(exposureSearch.value.toLowerCase()))
    .slice(0, Number(props.settings.limit ?? 50)),
);
const funds = computed(() => props.analytics.holdings.filter((row) => row.isFund));
const performerPeriod = computed(() =>
  dashboardRange.value
    ? 'custom'
    : INVESTMENT_PERFORMER_PERIODS.some(([period]) => period === props.settings.performerPeriod)
      ? String(props.settings.performerPeriod)
      : 'daily',
);
const periodToPreset: Record<string, string> = {
  daily: '1D',
  weekly: '1W',
  monthly: '1M',
  '3m': '3M',
  '6m': '6M',
  ytd: 'YTD',
  '1y': '1Y',
  '2y': '2Y',
  '5y': '5Y',
  all: 'MAX',
  unrealized: 'MAX',
};
const performanceRange = computed<PayrollRange>({
  get: () =>
    props.settings.from && props.settings.through
      ? investmentRange(props.settings, earliest.value)
      : investmentRange(
          {
            dateRange:
              periodToPreset[
                String(props.kind === 'heatmap' ? (props.settings.colorBy ?? 'daily') : performerPeriod.value)
              ] ?? '1D',
          },
          earliest.value,
        ),
  set: (value) => {
    const periods: Record<string, string> = {
      '1d': 'daily',
      '1w': 'weekly',
      '1m': 'monthly',
      '3m': '3m',
      '6m': '6m',
      ytd: 'ytd',
      '1y': '1y',
      '2y': '2y',
      '5y': '5y',
      all: 'unrealized',
      custom: 'custom',
    };
    emit('settings-change', {
      ...investmentRangeSettings(value),
      [props.kind === 'heatmap' ? 'colorBy' : 'performerPeriod']: periods[value.preset] ?? 'daily',
    });
  },
});
const performers = computed(() =>
  rankInvestmentPerformers(
    props.analytics.holdings,
    performerPeriod.value,
    String(props.settings.securityId ?? ''),
    usesCustomPositionPeriod(props.settings, performerPeriod.value),
  ),
);
const performerGroups = computed(() => {
  const filtered = performers.value;
  return [
    {
      label: 'Best',
      rows: filtered.slice(0, Number(props.settings.limit ?? 5)),
    },
    {
      label: 'Worst',
      rows: [...filtered].reverse().slice(0, Number(props.settings.limit ?? 5)),
    },
  ];
});
const largest = computed(() =>
  props.analytics.exposure
    .filter(
      (row) =>
        !row.unknown &&
        !/derivative|cash|money market|commodity|gold|fixed income|repurchase|liabilit|unclassified asset|collateral|crypto|other reported assets/i.test(
          row.assetClass ?? '',
        ),
    )
    .sort((a, b) => Number(b.totalValue ?? 0) - Number(a.totalValue ?? 0))
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
      <div class="grid grid-cols-2 gap-x-4 gap-y-2" :class="!compact && kind === 'overview' ? '@3xl:grid-cols-4' : ''">
        <div v-for="key in metricKeys" :key="key">
          <p class="text-muted-foreground text-xs">
            {{ displayedMetric(key).label }}
          </p>
          <button
            type="button"
            class="mt-1 text-sm font-semibold tracking-tight break-words tabular-nums @md:text-xl"
            :aria-label="displayedMetric(key).label + (displayedMetric(key).reason ? ' · data details' : '')"
            aria-haspopup="dialog"
            @click="activeMetric = key"
            :class="
              key.toLowerCase().includes('gain') || key === 'dailyChange' || kind === 'risk'
                ? signed(displayedMetric(key).value)
                : ''
            "
          >
            <span v-if="analytics.metrics[key]?.estimated" aria-label="Estimated">≈ </span>
            {{ percentMetrics.has(key) ? pct(displayedMetric(key).value) : money(displayedMetric(key).value) }}
          </button>
          <p
            v-if="key === 'dailyChange' && analytics.metrics.dailyChangePercent?.value != null"
            class="text-xs tabular-nums"
            :class="signed(analytics.metrics.dailyChange?.value)"
          >
            {{ pct(analytics.metrics.dailyChangePercent.value) }}
          </p>
        </div>
      </div>
      <details v-if="kind === 'overview'" class="border-t pt-3">
        <summary class="text-primary-text cursor-pointer text-xs">Income, cost basis and return details</summary>
        <dl class="mt-3 grid grid-cols-2 gap-3 @2xl:grid-cols-3">
          <div v-for="key in secondary" :key="key">
            <dt class="text-muted-foreground text-xs">
              {{ displayedMetric(key).label }}
            </dt>
            <dd
              class="font-medium tabular-nums"
              :class="key.toLowerCase().includes('gain') ? signed(displayedMetric(key).value) : ''"
            >
              <button type="button" class="text-left" aria-haspopup="dialog" @click="activeMetric = key">
                {{ percentMetrics.has(key) ? pct(displayedMetric(key).value) : money(displayedMetric(key).value) }}
              </button>
            </dd>
          </div>
        </dl>
      </details>
    </template>
    <MetricBreakdown
      v-if="activeMetric"
      :open="true"
      @update:open="
        (value) => {
          if (!value) activeMetric = null;
        }
      "
      :analytics="analytics"
      :metric="activeMetric"
      :label="displayedMetric(activeMetric).label ?? activeMetric"
      :value="displayedMetric(activeMetric).value"
      :reason="displayedMetric(activeMetric).reason"
    />
    <p
      v-show="inlineInformation && showInformation"
      v-if="kind === 'concentration'"
      class="text-muted-foreground text-xs"
    >
      Dated fund composition coverage
      {{ pct(analytics.coverage.lookThroughPercent) }} · effective dates
      {{ compositionDates.join(', ') || 'unavailable' }}. Cash, commodities and derivatives are excluded from company
      concentration.
    </p>
    <template v-if="showChart">
      <HistoryCoverage
        v-if="analytics.accountHistory && !compact && showInformation"
        :history="analytics.accountHistory"
      />
      <DateRange v-model="range" :earliest="earliest" :compact="compact" subject="investment">
        <template #actions
          ><Popover v-if="kind === 'performance'"
            ><PopoverTrigger as-child
              ><Button size="icon" variant="ghost" class="size-7" aria-label="Investment chart settings"
                ><SettingsIcon class="size-3.5" /></Button></PopoverTrigger
            ><PopoverContent align="end" class="w-64"
              ><label class="mb-2 block text-xs"
                >Display<select
                  :value="settings.unit === 'period-gains' ? 'gains' : (settings.unit ?? 'dollars')"
                  class="bg-background mt-1 w-full rounded border p-2"
                  @change="
                    emit('settings-change', {
                      unit: ($event.target as HTMLSelectElement).value,
                      series: undefined,
                    })
                  "
                >
                  <option value="dollars">Account value ($)</option>
                  <option value="gains">Gain / loss ($)</option>
                  <option value="percent">Return (%)</option>
                </select></label
              >
              <label v-if="analytics.accountHistory" class="flex items-center gap-2 py-1 text-xs"
                ><input
                  type="checkbox"
                  :checked="Boolean(settings.showEvents)"
                  @change="
                    emit('settings-change', {
                      showEvents: ($event.target as HTMLInputElement).checked,
                    })
                  "
                />Transaction markers</label
              >
              <label
                v-for="(label, key) in analytics.accountHistory || gainView ? {} : historyLabels"
                :key="key"
                class="flex items-center gap-2 py-1 text-xs"
                ><input
                  type="checkbox"
                  :checked="activeSeries.includes(String(key))"
                  @change="
                    emit('settings-change', {
                      unit: key === 'returnPercent' ? 'percent' : 'dollars',
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
      <WidgetHeaderControls v-if="kind === 'performance' && performanceSummary"
        ><div
          data-testid="investment-performance-summary"
          class="flex items-baseline gap-2 text-sm whitespace-nowrap sm:gap-3 sm:text-base"
        >
          <strong :class="signed(performanceSummary.gain)">{{ money(performanceSummary.gain) }}</strong>
          <strong
            :class="signed(performanceSummary.percent)"
            title="Estimated return weighted by dated deposits and withdrawals (Modified Dietz). Supported account history only."
            >{{ pct(performanceSummary.percent) }}</strong
          >
        </div></WidgetHeaderControls
      >
      <strong v-if="kind === 'dividends' && compact" class="text-2xl font-semibold tabular-nums">{{
        money(
          payments
            .filter((p) => p.type === 'dividend' && p.status === 'recorded')
            .reduce((sum, p) => sum + Number(p.amount), 0),
        )
      }}</strong>
      <template v-if="kind === 'dividends' && !compact"
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
            <p v-if="total.reason" class="text-muted-foreground text-[10px]">
              {{ total.reason }}
            </p>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <label class="text-muted-foreground text-xs"
            >Aggregation<select
              :value="settings.aggregation ?? 'monthly'"
              aria-label="Dividend aggregation"
              class="bg-background ml-2 rounded border px-2 py-1"
              @change="
                emit('settings-change', {
                  aggregation: ($event.target as HTMLSelectElement).value,
                })
              "
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
              @change="
                emit('settings-change', {
                  securityId: ($event.target as HTMLSelectElement).value,
                })
              "
            >
              <option value="">All securities</option>
              <option v-for="holding in analytics.holdings" :key="holding.id" :value="holding.securityId">
                {{ holding.symbol }}
              </option>
            </select></label
          >
        </div></template
      >
      <label
        v-if="kind === 'contributions' && !compact"
        class="text-muted-foreground flex flex-wrap items-center gap-2 text-xs"
        >Aggregation<select
          :value="settings.aggregation ?? 'monthly'"
          aria-label="Contribution aggregation"
          class="bg-background rounded-md border px-2 py-1.5"
          @change="
            emit('settings-change', {
              aggregation: ($event.target as HTMLSelectElement).value,
            })
          "
        >
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="yearly">Yearly</option>
        </select></label
      >
      <SeriesChart
        :points="plottedPoints"
        :series="chartSeries"
        :compact="compact"
        :percent="percent && kind !== 'portfolio-comparison'"
        :bars="kind === 'dividends' || kind === 'contributions'"
        :line-keys="kind === 'contributions' ? ['netContributions', 'previousAverage'] : []"
        :share-label="kind === 'contributions' ? 'absolute period flows' : 'period income'"
        :events="
          withinRange(analytics.events, range.from, range.through).map((row) => ({ date: row.date, label: row.label }))
        "
        :label="kind === 'dividends' ? 'Recorded investment income history' : 'Consolidated investment ' + kind"
      />
      <p
        v-show="inlineInformation && showInformation"
        v-if="recordedAccountFallback"
        class="text-muted-foreground text-xs"
        data-testid="investment-recorded-values-note"
      >
        Showing available recorded account values and known securities subtotals. Full consolidated value and
        invested-capital history are incomplete. Missing observations remain gaps; these balances are not investment
        returns.
      </p>
      <p
        v-show="inlineInformation && showInformation"
        v-if="kind === 'benchmark'"
        class="text-muted-foreground text-xs"
      >
        Series share an actual common starting observation. Benchmarks use recorded price history.
        {{
          priceRiskFallback
            ? 'The holdings line is a fixed basket of current quantities, not historical account performance.'
            : 'The portfolio line requires supported cash-flow-adjusted returns.'
        }}
      </p>
      <p
        v-show="inlineInformation && showInformation"
        v-if="priceRiskFallback && ['performance', 'risk', 'benchmark'].includes(kind)"
        class="text-muted-foreground text-xs"
        data-testid="investment-price-risk-note"
      >
        {{ analytics.priceRisk?.methodology }} Coverage: {{ pct(analytics.priceRisk?.coveragePercent) }} of known
        securities value · {{ analytics.priceRisk?.included }} holdings.
        {{ analytics.priceRisk?.excluded.length ? 'Excluded: ' + analytics.priceRisk.excluded.join(', ') + '.' : '' }}
      </p>
      <p
        v-for="benchmark in kind === 'benchmark' ? analytics.benchmarks : []"
        :key="benchmark.id"
        class="text-muted-foreground text-xs"
      >
        {{ benchmark.symbol }} · {{ benchmark.status }} ·
        {{ benchmark.reason ?? benchmark.returnType }}
      </p>
      <p
        v-show="inlineInformation && showInformation"
        v-if="kind === 'portfolio-comparison'"
        class="text-muted-foreground text-xs"
      >
        Recorded portfolio values in {{ analytics.currencyCode }}. Cash flows affect balances; these are not comparable
        investment returns.
      </p>
      <p
        v-show="inlineInformation && showInformation"
        v-if="kind === 'performance' || kind === 'value-capital'"
        class="text-muted-foreground text-xs"
      >
        Only dated recorded valuations and supported historical prices are used. Gaps indicate unavailable observations.
        Contributions and withdrawals are separate from investment gains.
      </p>
      <p
        v-show="inlineInformation && showInformation"
        v-if="kind === 'contributions'"
        class="text-muted-foreground text-xs"
      >
        {{
          analytics.metrics.contributions?.status !== 'verified' ||
          analytics.metrics.contributions?.value == null ||
          !analytics.portfolios.length ||
          analytics.portfolios.some((portfolio) => !portfolio.historyComplete)
            ? 'Recorded external flows; imported funding history may be incomplete.'
            : 'Recorded external flows; transfers within the selected portfolio group are excluded.'
        }}
      </p>
      <details v-if="kind === 'dividends' && !compact" class="border-t pt-3" data-testid="investment-income-breakdown">
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
          <span class="font-medium">Dividend growth: {{ pct(dividendGrowth.value) }}.</span>
          {{ dividendGrowth.reason }}
        </p>
      </details>
      <p
        v-show="inlineInformation && showInformation"
        v-if="kind === 'dividends'"
        class="text-muted-foreground text-xs"
      >
        Recorded income only; incomplete transaction history may omit earlier payments. Current indicated yield, yield
        on cost, dividend growth and forecasts require reliable distribution schedules and complete basis; unavailable
        estimates are not invented.
      </p>
      <p v-show="inlineInformation && showInformation" v-if="kind === 'risk'" class="text-muted-foreground text-xs">
        Account return metrics require complete funding and valuation history. Available price risk is labeled
        separately; deposits and withdrawals are never counted as investment gains.
      </p>
    </template>
    <template v-if="['allocation', 'sector', 'geography'].includes(kind)">
      <WidgetHeaderControls
        ><select
          :value="allocationMode"
          aria-label="Investment allocation mode"
          class="bg-background max-w-full rounded-md border px-2 py-1.5 text-xs"
          @change="
            selectedCategory = null;
            emit('settings-change', {
              allocationMode: ($event.target as HTMLSelectElement).value,
            });
          "
        >
          <option v-for="[id, label] in INVESTMENT_ALLOCATION_MODES" :key="id" :value="id">
            {{ label }}
          </option>
        </select></WidgetHeaderControls
      >
      <DrilldownDonut
        :data="allocationTree"
        :total="allocation.reduce((sum, row) => sum + Number(row.value), 0)"
        :label="allocationTotalLabel"
        :height-class="compact ? 'h-56' : 'h-64'"
        :compact="compact"
        :show-legend="false"
      />
      <p
        v-show="inlineInformation && showInformation"
        v-if="!fullAllocationKnown"
        class="text-muted-foreground text-xs"
      >
        Only known values are drawn; unvalued cash or positions prevent a complete portfolio total. Slice proportions
        describe this known subtotal. Listed weights use known investment assets; unknown cash and unpriced positions
        are excluded.
      </p>
      <p v-if="!allocation.length" class="text-muted-foreground text-sm">
        Classification data is unavailable for this mode.
      </p>
      <details v-if="!compact" class="text-xs">
        <summary class="text-primary-text cursor-pointer">Historical allocation availability</summary>
        <p v-show="inlineInformation && showInformation" class="text-muted-foreground mt-2">
          Historical allocation changes require dated position valuations and fund compositions for each observation.
          This selection has no complete historical composition series. Current fund weights are never applied to past
          dates.
        </p>
      </details>
      <p
        v-show="inlineInformation && showInformation"
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
    <template v-if="kind === 'heatmap'"
      ><DateRange v-model="performanceRange" :earliest="earliest" :compact="compact" subject="investment" /><Treemap
        :analytics="analytics"
        :settings="settings"
        :compact="compact"
    /></template>
    <template v-if="kind === 'exposure'"
      ><p v-show="inlineInformation && showInformation" class="text-muted-foreground text-xs">
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
        <summary class="text-primary-text cursor-pointer">Non-company assets · {{ money(nonCompanyTotal) }}</summary>
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
      ><p v-show="inlineInformation && showInformation" class="text-muted-foreground text-xs">
        Weighted overlap is the sum of minimum comparable company weights. Select a fund pair to inspect shared
        companies.
      </p>
      <ScrollArea with-horizontal-scrollbar>
        <table class="w-full text-xs" data-testid="investment-overlap-matrix">
          <thead>
            <tr>
              <th class="p-2 text-left">Funds</th>
              <th v-for="fund in funds" :key="fund.id" class="p-2">
                {{ fund.symbol }}
              </th>
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
                  :style="overlapStrength(left.securityId, right.securityId)"
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
      </ScrollArea>
      <div v-if="overlap" class="bg-muted/40 rounded-md p-3 text-xs">
        <OverlapDetails
          :pair="overlap"
          :currency-code="analytics.currencyCode"
          :portfolio-ids="analytics.selectedPortfolioIds"
        />
        <Button size="sm" variant="ghost" class="mt-2" @click="overlap = null">Close details</Button>
      </div>
      <p v-if="funds.length < 2" class="text-muted-foreground text-sm">
        Select at least two held funds to compare overlap.
      </p></template
    >
    <template v-if="kind === 'dividend-calendar'"
      ><DateRange v-model="range" :earliest="earliest" :compact="compact" subject="investment" />
      <div class="flex items-center justify-between">
        <Button variant="ghost" size="icon-sm" aria-label="Previous dividend month" @click="moveDividendMonth(-1)"
          >?</Button
        >
        <strong class="text-sm">{{ calendarMonth }}</strong>
        <Button variant="ghost" size="icon-sm" aria-label="Next dividend month" @click="moveDividendMonth(1)">?</Button>
      </div>
      <div class="grid grid-cols-7 gap-1 text-center text-xs" aria-label="Dividend calendar">
        <span
          v-for="day in ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']"
          :key="day"
          class="text-muted-foreground"
          >{{ day }}</span
        >
        <template v-for="(cell, index) in calendarCells" :key="index">
          <button
            v-if="cell"
            class="rounded-md border p-2 tabular-nums"
            :class="
              cell.count ? 'bg-app-income-color/25 text-app-income-color cursor-pointer' : 'text-muted-foreground'
            "
            :disabled="!cell.count"
            :aria-pressed="dividendDay === cell.date"
            :title="cell.count ? money(cell.amount) + ' ? ' + cell.count + ' payments' : 'No recorded dividends'"
            @click="dividendDay = dividendDay === cell.date ? null : cell.date"
          >
            {{ cell.day }}<span v-if="cell.count" class="block text-[10px]">{{ money(cell.amount) }}</span>
          </button>
          <span v-else />
        </template>
      </div>
      <ModuleBody
        ><div
          v-for="row in selectedDividendPayments"
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
          <p
            v-show="inlineInformation && showInformation"
            v-if="!upcomingPayments.length"
            class="text-muted-foreground py-3 text-xs"
          >
            No announced or supported estimated payment schedule is available.
          </p></ModuleBody
        >
      </div>
      <p v-show="inlineInformation && showInformation" class="text-muted-foreground text-xs">
        Upcoming payments require announced source dates. Forecasts are estimates; recorded dividends are never
        duplicated as contributions.
      </p></template
    >
    <template v-if="kind === 'performers'"
      ><DateRange v-model="performanceRange" :earliest="earliest" :compact="compact" subject="investment" />
      <p v-show="inlineInformation && showInformation" class="text-muted-foreground text-xs">
        {{
          performerPeriod === 'unrealized'
            ? 'Open-position unrealized return uses reliable remaining cost basis and valuation.'
            : 'Position returns use native opening valuations and recorded net trades, fees and distributions. Missing opening positions are excluded.'
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
      <p v-show="inlineInformation && showInformation" class="text-muted-foreground text-xs">
        Underlying companies · direct and fund exposure combined.
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
      <p v-show="inlineInformation && showInformation" class="text-muted-foreground text-xs">
        {{ analytics.refresh.provider }} · last price check {{ analytics.refresh.lastSuccess ?? 'unavailable' }} ·
        {{ analytics.refresh.schedule }}
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
        inlineInformation &&
        showInformation &&
        analytics.composition?.length &&
        ['health', 'allocation', 'sector', 'geography', 'exposure', 'overlap'].includes(kind)
      "
      :rows="analytics.composition"
      :compact="compact"
    />
    <button
      v-if="inlineInformation && !compact"
      type="button"
      class="text-muted-foreground self-start text-xs"
      :aria-expanded="showInformation"
      @click="showInformation = !showInformation"
    >
      Information
    </button>
  </div>
</template>
