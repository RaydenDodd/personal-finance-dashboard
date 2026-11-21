import type { InvestmentAnalytics, InvestmentDividend } from '@bt/shared/types/investment-analytics';
// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AnalyticsPanel from './analytics-panel.vue';

const base = (): InvestmentAnalytics => ({
  generatedAt: '2026-11-20T12:00:00Z',
  currencyCode: 'USD',
  selectedPortfolioIds: [],
  portfolios: [],
  metrics: {
    marketValue: { value: null, status: 'unavailable', reason: 'One unvalued position' },
    knownMarketValue: { value: '1000', status: 'partial' },
  },
  holdings: [],
  history: [],
  events: [],
  dividends: [],
  exposure: [],
  allocations: {},
  fundSnapshots: [],
  overlap: [],
  benchmarks: [],
  health: [],
  coverage: {
    historyStart: '2024-01-01',
    historyEnd: '2026-11-20',
    costBasisPercent: '0',
    lookThroughPercent: '0',
    pricePercent: '0',
    methodology: [],
  },
  refresh: { supported: false, lastSuccess: null, schedule: 'Existing schedule', provider: 'Existing providers' },
});
const stubs = {
  ExpenseDonut: true,
  SeriesChart: true,
  HoldingsTable: true,
  Treemap: true,
  DateRange: true,
  ModuleBody: { template: '<div><slot/></div>' },
};
const panel = (kind: string, analytics = base(), settings: Record<string, unknown> = {}) =>
  mount(AnalyticsPanel, { props: { kind, analytics, settings: { dateRange: 'MAX', ...settings } }, global: { stubs } });

describe('shared investment panels', () => {
  it('opens the actual metric breakdown and keeps explanations out of the overview', async () => {
    const wrapper = panel('overview');
    expect(wrapper.text()).toContain('Known investment value');
    expect(wrapper.text()).toContain('$1,000.00');
    expect(wrapper.text()).not.toContain('One unvalued position');
    expect(wrapper.text()).not.toContain('Partial ·');
    expect(wrapper.text()).toContain('Unavailable');
    await wrapper.get('button[aria-haspopup="dialog"]').trigger('click');
    expect(wrapper.findComponent({ name: 'MetricBreakdown' }).props()).toMatchObject({
      metric: 'marketValue',
      value: '1000',
      reason: 'One unvalued position',
    });
    wrapper.unmount();
  });
  it('separates unknown dividend treatment from actual cash and reinvestment', () => {
    const analytics = base();
    analytics.dividends = [null, false, true].map(
      (reinvested, index) =>
        ({
          id: String(index),
          date: '2026-01-15',
          portfolioId: 'p',
          portfolioName: 'Portfolio',
          securityId: 's',
          symbol: 'FUND',
          name: 'Fund',
          amount: '10',
          currencyCode: 'USD',
          status: 'recorded',
          reinvested,
          type: 'dividend',
        }) as InvestmentDividend,
    );
    const wrapper = panel('dividends', analytics);
    const chart = wrapper.findComponent({ name: 'SeriesChart' });
    expect(chart.props('points')[0].values).toEqual({ cash: 10, reinvested: 10, unknown: 10, interest: 0 });
  });
  it('keeps unavailable interest unavailable instead of reducing an empty source to verified zero', () => {
    const analytics = base();
    analytics.metrics.interest = { value: null, status: 'unavailable', reason: 'No verified interest history.' };
    analytics.metrics.dividends = { value: '10', status: 'partial' };
    analytics.dividends = [
      {
        id: 'synthetic',
        date: '2026-11-01',
        portfolioId: 'p',
        portfolioName: 'Portfolio',
        securityId: 'synthetic',
        symbol: 'SYNTH',
        name: 'Synthetic',
        amount: '10',
        currencyCode: 'USD',
        status: 'recorded',
        reinvested: false,
        type: 'dividend',
      },
    ];
    const wrapper = panel('dividends', analytics);
    const interest = wrapper.get('[data-testid="investment-income-summary-interest"]');
    expect(interest.text()).toContain('Unavailable');
    expect(interest.text()).toContain('No verified interest history.');
    expect(interest.text()).not.toContain('$0.00');
    const lifetime = wrapper.get('[data-testid="investment-income-summary-lifetime"]');
    expect(lifetime.text()).toContain('Recorded dividends');
    expect(lifetime.text()).toContain('partial history');
    const breakdownInterest = wrapper.get('[data-testid="investment-income-breakdown-interest-synthetic"]');
    expect(breakdownInterest.text()).toContain('Unavailable');
    expect(breakdownInterest.text()).not.toContain('$0.00');
  });
  it('keeps recorded income summaries scoped to the selected security', () => {
    const analytics = base();
    analytics.metrics.interest = { value: '5', status: 'partial' };
    analytics.metrics.dividends = { value: '0', status: 'partial' };
    analytics.dividends = [
      {
        id: 'one',
        date: '2026-11-01',
        portfolioId: 'p',
        portfolioName: 'Portfolio',
        securityId: 'one',
        symbol: 'SYNTH-A',
        name: 'Synthetic A',
        amount: '2',
        currencyCode: 'USD',
        status: 'recorded',
        reinvested: false,
        type: 'interest',
      },
      {
        id: 'two',
        date: '2026-11-01',
        portfolioId: 'p',
        portfolioName: 'Portfolio',
        securityId: 'two',
        symbol: 'SYNTH-B',
        name: 'Synthetic B',
        amount: '3',
        currencyCode: 'USD',
        status: 'recorded',
        reinvested: false,
        type: 'interest',
      },
    ];
    const interest = panel('dividends', analytics, { securityId: 'one' }).get(
      '[data-testid="investment-income-summary-interest"]',
    );
    expect(interest.text()).toContain('$2.00');
    expect(interest.text()).not.toContain('$5.00');
    expect(interest.text()).toContain('partial history');
  });
  it('keeps portfolio comparison in dollars when only balances are recorded', () => {
    const wrapper = panel('portfolio-comparison', base(), { unit: 'percent' });
    expect(wrapper.findComponent({ name: 'SeriesChart' }).props('percent')).toBe(false);
    expect(wrapper.text()).toContain('these are not comparable investment returns');
  });
  it('keeps value versus invested capital in dollars even with old percent settings', () => {
    const wrapper = panel('value-capital', base(), { unit: 'percent' });
    expect(wrapper.findComponent({ name: 'SeriesChart' }).props('percent')).toBe(false);
  });
  it('ranks actual position changes instead of substituting historical price appreciation', async () => {
    const analytics = base();
    analytics.holdings = [
      {
        id: 'synthetic',
        securityId: 'synthetic',
        symbol: 'SYNTH',
        name: 'Synthetic',
        unrealizedPercent: '40',
        dailyChangePercent: '1',
        periodReturns: { daily: '579.96', weekly: '-2' },
      },
    ] as InvestmentAnalytics['holdings'];
    const wrapper = panel('performers', analytics);
    expect(wrapper.get('[data-testid="investment-performer-row"]').text()).toContain('1.00%');
    expect(wrapper.text()).not.toContain('579.96%');
    await wrapper.setProps({ settings: { dateRange: 'MAX', performerPeriod: 'weekly' } });
    expect(wrapper.find('[data-testid="investment-performer-row"]').exists()).toBe(false);
    await wrapper.setProps({ settings: { dateRange: 'MAX', performerPeriod: 'unrealized' } });
    expect(wrapper.get('[data-testid="investment-performer-row"]').text()).toContain('40.00%');
  });
  it('preserves unsupported risk as gaps instead of substituting account balance returns', () => {
    const analytics = base();
    analytics.history = [
      {
        date: '2025-01-01',
        marketValue: '100',
        netInvested: '50',
        cumulativeGain: '50',
        unrealizedGain: null,
        realizedGain: null,
        returnPercent: null,
        contributions: '50',
        withdrawals: '0',
        portfolios: { p: '100' },
        coverage: 50,
        source: 'recorded',
      },
    ];
    const wrapper = panel('risk', analytics);
    expect(wrapper.findComponent({ name: 'SeriesChart' }).props('points')).toEqual([]);
  });
  it('shows announced future payments separately from the historical calendar range', () => {
    const analytics = base();
    analytics.dividends = [
      {
        id: 'future',
        date: '2026-12-15',
        portfolioId: 'p',
        portfolioName: 'Portfolio',
        securityId: 's',
        symbol: 'FUND',
        name: 'Fund',
        amount: '15',
        currencyCode: 'USD',
        status: 'announced',
        reinvested: null,
        type: 'dividend',
      },
    ];
    const wrapper = panel('dividend-calendar', analytics);
    expect(wrapper.get('[data-testid="investment-upcoming-dividends"]').text()).toContain('2026-12-15');
    expect(wrapper.get('[data-testid="investment-upcoming-dividends"]').text()).toContain('Announced payment');
  });
  it('groups recorded investment income by account without counting an upcoming estimate', () => {
    const analytics = base();
    analytics.dividends = [
      {
        id: 'one',
        date: '2026-01-15',
        portfolioId: 'p',
        portfolioName: 'Portfolio A',
        securityId: 's',
        symbol: 'FUND',
        name: 'Fund',
        amount: '10',
        currencyCode: 'USD',
        status: 'recorded',
        reinvested: true,
        type: 'dividend',
      },
      {
        id: 'two',
        date: '2026-02-15',
        portfolioId: 'p',
        portfolioName: 'Portfolio A',
        securityId: 'other',
        symbol: 'OTHER',
        name: 'Other',
        amount: '2',
        currencyCode: 'USD',
        status: 'recorded',
        reinvested: false,
        type: 'interest',
      },
      {
        id: 'future',
        date: '2026-12-15',
        portfolioId: 'p',
        portfolioName: 'Portfolio A',
        securityId: 's',
        symbol: 'FUND',
        name: 'Fund',
        amount: '1000',
        currencyCode: 'USD',
        status: 'estimated',
        reinvested: null,
        type: 'dividend',
      },
    ];
    const wrapper = panel('dividends', analytics, { dividendGrouping: 'portfolio' });
    const breakdown = wrapper.get('[data-testid="investment-income-breakdown"]').text();
    expect(breakdown).toContain('Portfolio A');
    expect(breakdown).toContain('$12.00');
    expect(breakdown).not.toContain('$1,000.00');
    expect(breakdown).toContain('Dividend growth: Unavailable');
  });
});
