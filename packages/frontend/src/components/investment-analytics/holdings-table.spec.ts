import type { InvestmentAnalytics } from '@bt/shared/types/investment-analytics';
// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { it, expect } from 'vitest';

import Holdings from './holdings-table.vue';
it('sorts shares, dividends, daily dollars and portfolio weight numerically', async () => {
  const holdings = [
    {
      id: 'a',
      securityId: 'a',
      symbol: 'AAA',
      name: 'First',
      quantity: '2',
      marketValue: '20',
      weight: '20',
      dividends: '10',
      dailyChange: '-2',
    },
    {
      id: 'b',
      securityId: 'b',
      symbol: 'BBB',
      name: 'Second',
      quantity: '100',
      marketValue: '10',
      weight: '80',
      dividends: '2',
      dailyChange: '5',
    },
  ].map((h) => ({
    ...h,
    currencyCode: 'USD',
    accounts: [],
    averageCost: '1',
    costBasis: '1',
    price: '1',
    unrealizedGain: '1',
    unrealizedPercent: '1',
    realizedGain: '1',
    dailyChangePercent: '1',
    portfolioCount: 1,
  }));
  const w = mount(Holdings, {
    props: { analytics: { holdings, currencyCode: 'USD' } as unknown as InvestmentAnalytics },
    global: { stubs: { SecurityHistory: true, 'router-link': true } },
  });
  const first = () => w.get('[data-testid="investment-holdings-table"] tbody').text();
  for (const [label, symbol] of [
    ['Shares / units', 'BBB'],
    ['Dividends', 'AAA'],
    ['Daily', 'BBB'],
    ['Weight', 'BBB'],
  ]) {
    const button = w.findAll('th button').find((b) => b.text().startsWith(label!))!;
    await button.trigger('click');
    expect(first()).toContain(symbol);
  }
  w.unmount();
});
