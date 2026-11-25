import type { DashboardWidgetConfig } from '@/api/user-settings';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';

import { INVESTMENT_WIDGETS } from './investment-widgets';

const analytics = ref<unknown>({ selectedPortfolioIds: ['a'], holdings: [], metrics: {} });
const pending = ref(false);
const error = ref<unknown>(null);
const queryCalls: {
  portfolioIds: { value: string[] };
  benchmarks: { value: string[] };
  performanceThrough?: { value: string | undefined };
}[] = [];
const refetch = vi.fn();
vi.mock('@/composable/data-queries/investment-analytics', () => ({
  useInvestmentAnalytics: (args: (typeof queryCalls)[number]) => {
    queryCalls.push(args);
    return { data: analytics, isPending: pending, isFetching: computed(() => pending.value), error, refetch };
  },
}));
vi.mock('@/composable/data-queries/investment-history', () => ({
  useInvestmentHistory: () => ({
    data: analytics,
    isPending: pending,
    isFetching: computed(() => pending.value),
    error,
    refetch,
  }),
}));
vi.mock('@/composable/data-queries/portfolios', () => ({
  usePortfolios: () => ({ data: ref([{ id: 'a', name: 'Broker A' }]) }),
}));
vi.mock('@/components/investment-analytics/analytics-panel.vue', () => ({
  default: {
    name: 'AnalyticsPanel',
    props: { analytics: Object, kind: String, settings: Object, compact: Boolean, inlinePerformanceHeader: Boolean },
    emits: ['settings-change'],
    template: '<div data-testid="shared-investment-panel">{{ kind }}</div>',
  },
}));
vi.mock('./investment-widget-settings.vue', () => ({
  default: {
    name: 'InvestmentWidgetSettings',
    props: ['settings', 'open', 'kind', 'saveError'],
    emits: ['save', 'update:open'],
    template: '<div data-testid="settings">{{ saveError }}</div>',
  },
}));
vi.mock('./components/widget-wrapper.vue', () => ({
  default: { template: '<div><slot name="title" /><slot name="action" /><slot /></div>' },
}));
vi.mock('./components/loading-state.vue', () => ({
  default: { template: '<div data-testid="loading">Loading</div>' },
}));
vi.mock('./components/error-state.vue', () => ({
  default: {
    props: ['message'],
    emits: ['retry'],
    template: '<button data-testid="error" @click="$emit(\'retry\')">{{ message }}</button>',
  },
}));
import InvestmentWidget from './investment-widget.vue';

describe('investment widget adapters use shared live analytics', () => {
  beforeEach(() => {
    queryCalls.length = 0;
    analytics.value = { selectedPortfolioIds: ['a'], holdings: [], metrics: {} };
    pending.value = false;
    error.value = null;
    refetch.mockReset();
  });
  const create = (kind: string, config: Record<string, unknown> = {}, period?: ReturnType<typeof ref>) => {
    const widget = ref<DashboardWidgetConfig>({
      widgetId: `investment-${kind}`,
      instanceId: 'instance-b',
      colSpan: 2,
      config,
    });
    const persist = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(InvestmentWidget, {
      global: {
        provide: {
          'dashboard-widget-config': widget,
          'dashboard-save-widget-config': persist,
          ...(period ? { 'dashboard-period': period } : {}),
        },
        stubs: { 'router-link': { template: '<a><slot /></a>' } },
      },
    });
    return { wrapper, persist, widget };
  };

  it.each(INVESTMENT_WIDGETS)('%s connects its shared panel to selected portfolio data', async (kind) => {
    const { wrapper, widget } = create(kind, { portfolioIds: ['a'], benchmarks: ['QQQ'], dateRange: 'YTD' });
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]!.portfolioIds.value).toEqual(kind === 'performance' ? [] : ['a']);
    expect(queryCalls[0]!.benchmarks.value).toEqual(kind === 'benchmark' ? ['QQQ'] : []);
    const panel = wrapper.findComponent({ name: 'AnalyticsPanel' });
    expect(panel.props('analytics')).toBe(analytics.value);
    expect(panel.props('kind')).toBe(kind);
    expect(panel.props('settings')).toMatchObject({
      portfolioIds: kind === 'performance' ? [] : ['a'],
      dateRange: 'YTD',
    });
    expect(panel.props('compact')).toBe(true);
    widget.value.config = { portfolioIds: ['b', 'c'], dateRange: '3M' };
    await nextTick();
    expect(queryCalls[0]!.portfolioIds.value).toEqual(kind === 'performance' ? [] : ['b', 'c']);
    expect(panel.props('settings')).toMatchObject({
      portfolioIds: kind === 'performance' ? [] : ['b', 'c'],
      dateRange: '3M',
    });
    wrapper.unmount();
  });

  it('persists chart date and gear changes using the instance identity', async () => {
    const { wrapper, persist } = create('allocation');
    wrapper
      .findComponent({ name: 'AnalyticsPanel' })
      .vm.$emit('settings-change', { dateRange: 'custom', from: '2025-01-01', through: '2025-12-31' });
    await nextTick();
    expect(persist).toHaveBeenLastCalledWith({
      widgetId: 'instance-b',
      config: { dateRange: 'custom', from: '2025-01-01', through: '2025-12-31' },
    });
    await nextTick();
    wrapper
      .findComponent({ name: 'InvestmentWidgetSettings' })
      .vm.$emit('save', { allocationMode: 'underlying', portfolioIds: ['b'] });
    await nextTick();
    expect(persist).toHaveBeenLastCalledWith({
      widgetId: 'instance-b',
      config: { allocationMode: 'underlying', portfolioIds: ['b'] },
    });
    wrapper.unmount();
  });

  it('shows loading and retry states without rendering fabricated analytics', async () => {
    pending.value = true;
    const { wrapper } = create('overview');
    expect(wrapper.find('[data-testid="loading"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'AnalyticsPanel' }).exists()).toBe(false);
    pending.value = false;
    error.value = new Error('Unavailable');
    await nextTick();
    await wrapper.get('[data-testid="error"]').trigger('click');
    expect(refetch).toHaveBeenCalledOnce();
    expect(wrapper.findComponent({ name: 'AnalyticsPanel' }).exists()).toBe(false);
    error.value = null;
    analytics.value = undefined;
    await nextTick();
    expect(wrapper.text()).toContain('Investment analytics are unavailable');
    wrapper.unmount();
  });

  it('keeps a failed settings change reviewable and reports persistence errors', async () => {
    const { wrapper, persist } = create('holdings');
    persist.mockRejectedValueOnce(new Error('Offline'));
    wrapper.findComponent({ name: 'InvestmentWidgetSettings' }).vm.$emit('save', { portfolioIds: ['b'] });
    await nextTick();
    await nextTick();
    expect(wrapper.text()).toContain('Settings could not be saved');
    expect(wrapper.findComponent({ name: 'AnalyticsPanel' }).props('settings').portfolioIds).toEqual(['b']);
    wrapper.unmount();
  });

  it('serializes rapid chart changes and retains the newest settings while an earlier save is in flight', async () => {
    const { wrapper, persist, widget } = create('performance', { dateRange: '1Y' });
    let completeFirst!: () => void;
    persist
      .mockImplementationOnce(
        ({ config }) =>
          new Promise<void>((resolve) => {
            completeFirst = () => {
              widget.value.config = { ...widget.value.config, ...config };
              resolve();
            };
          }),
      )
      .mockImplementation(async ({ config }) => {
        widget.value.config = { ...widget.value.config, ...config };
      });
    const panel = wrapper.findComponent({ name: 'AnalyticsPanel' });
    panel.vm.$emit('settings-change', { dateRange: '3M', from: '2026-08-20', through: '2026-11-20' });
    panel.vm.$emit('settings-change', { dateRange: '6M', from: '2026-05-20', through: '2026-11-20' });
    panel.vm.$emit('settings-change', { series: ['marketValue', 'netInvested'] });
    await nextTick();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(panel.props('settings')).toMatchObject({ dateRange: '6M', series: ['marketValue', 'netInvested'] });
    completeFirst();
    await nextTick();
    await nextTick();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith({
      widgetId: 'instance-b',
      config: { dateRange: '6M', from: '2026-05-20', through: '2026-11-20', series: ['marketValue', 'netInvested'] },
    });
    expect(widget.value.config).toMatchObject({
      dateRange: '6M',
      from: '2026-05-20',
      series: ['marketValue', 'netInvested'],
    });
    expect(panel.props('settings').dateRange).toBe('6M');
    wrapper.unmount();
  });
});

it('follows the Dashboard month without persisting it into each widget configuration', async () => {
  const period = ref({ from: new Date(2026, 9, 1), to: new Date(2026, 9, 31) });
  const widget = ref<DashboardWidgetConfig>({
    widgetId: 'investment-performance',
    instanceId: 'test-period',
    colSpan: 2,
    config: { dateRange: '1Y', portfolioIds: ['a'], unit: 'percent', breakdown: 'accounts' },
  });
  const persist = vi.fn();
  const wrapper = mount(InvestmentWidget, {
    global: {
      provide: {
        'dashboard-widget-config': widget,
        'dashboard-save-widget-config': persist,
        'dashboard-period': period,
      },
      stubs: { 'router-link': { template: '<a><slot/></a>' } },
    },
  });
  const panel = wrapper.findComponent({ name: 'AnalyticsPanel' });
  expect(panel.props('settings')).toMatchObject({
    dateRange: 'custom',
    from: '2026-10-01',
    through: '2026-10-31',
    unit: 'percent',
    breakdown: 'combined',
    portfolioIds: [],
  });
  period.value = { from: new Date(2026, 8, 1), to: new Date(2026, 8, 30) };
  await nextTick();
  expect(panel.props('settings').from).toBe('2026-09-01');
  panel.vm.$emit('settings-change', { dateRange: 'custom', from: '2026-09-01', through: '2026-09-30' });
  await nextTick();
  expect(persist).not.toHaveBeenCalled();
  expect(widget.value.config?.dateRange).toBe('1Y');
  wrapper.unmount();
});

it('does not send a future Dashboard month-end to the holding-performance endpoint', () => {
  const date = new Date(),
    year = date.getFullYear();
  const period = ref({ from: new Date(year, 0, 1), to: new Date(year, 11, 31) });
  const widget = ref<DashboardWidgetConfig>({ widgetId: 'investment-heatmap', instanceId: 'range-test', colSpan: 2 });
  const wrapper = mount(InvestmentWidget, {
    global: {
      provide: { 'dashboard-widget-config': widget, 'dashboard-period': period },
      stubs: { 'router-link': { template: '<a><slot/></a>' } },
    },
  });
  const through = queryCalls.at(-1)?.performanceThrough?.value;
  expect(through).toBeDefined();
  expect(Date.parse(through!)).toBeLessThanOrEqual(Date.now());
  wrapper.unmount();
});

it('shares the report selection across Dashboard tile kinds instead of fetching parallel reports', () => {
  const period = ref({ from: new Date(2026, 9, 1), to: new Date(2026, 9, 31) }),
    shared = ref(['SPY']);
  const mountKind = (kind: string) =>
    mount(InvestmentWidget, {
      global: {
        provide: {
          'dashboard-widget-config': ref({ widgetId: 'investment-' + kind, colSpan: 2 }),
          'dashboard-period': period,
          'investment-shared-benchmarks': shared,
        },
        stubs: { 'router-link': { template: '<a><slot/></a>' } },
      },
    });
  const first = mountKind('allocation'),
    second = mountKind('heatmap');
  const a = queryCalls.at(-2)!,
    b = queryCalls.at(-1)!;
  expect(a.benchmarks.value).toEqual(b.benchmarks.value);
  expect(a.performanceThrough?.value).toBe(b.performanceThrough?.value);
  first.unmount();
  second.unmount();
});


it('puts signed period returns beside the period toggle and persists the header chart mode', async () => {
  const period = ref({ from: new Date(2026, 9, 1), to: new Date(2026, 9, 31) });
  analytics.value = { currencyCode: 'USD', accountHistory: { gainFrom: '2026-10-01', dates: ['2026-10-31'], accounts: [], periodGains: ['247.82'], periodReturnPercent: ['0.83'] } };
  const widget = ref<DashboardWidgetConfig>({ widgetId: 'investment-performance', instanceId: 'performance-header', colSpan: 2, config: { unit: 'dollars' } });
  const persist = vi.fn(async ({ config }) => { widget.value.config = { ...widget.value.config, ...config }; });
  const wrapper = mount(InvestmentWidget, {
    global: { provide: { 'dashboard-widget-config': widget, 'dashboard-save-widget-config': persist, 'dashboard-period': period },
      stubs: { 'router-link': { template: '<a><slot/></a>' } } },
  });
  const summary = wrapper.get('[data-testid="investment-performance-summary"]');
  expect(summary.text()).toContain('+$247.82');
  expect(summary.text()).toContain('+0.83%');
  expect(summary.element.previousElementSibling?.getAttribute('aria-label')).toBe('Widget period');
  const modes = wrapper.get('[aria-label="Portfolio performance chart mode"]');
  expect(modes.findAll('button').map((button) => button.text())).toEqual(['$', '+/-', '%']);
  expect(modes.element.nextElementSibling).toBe(wrapper.get('[aria-label="Open Investments page"]').element);
  expect(wrapper.findComponent({ name: 'AnalyticsPanel' }).props('inlinePerformanceHeader')).toBe(true);
  await modes.get('[aria-label="Dollar gain / loss"]').trigger('click');
  expect(persist).toHaveBeenCalledWith({ widgetId: 'performance-header', config: { unit: 'gains', series: undefined } });
  expect(wrapper.findComponent({ name: 'AnalyticsPanel' }).props('settings').unit).toBe('gains');
  expect(summary.text()).toContain('+$247.82');
  wrapper.unmount();
});
