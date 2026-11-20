import type { InvestmentAnalytics } from '@bt/shared/types/investment-analytics';
import { describe, expect, it } from 'vitest';

import { investmentTreemapRows } from './treemap-model';
const fixture = (): InvestmentAnalytics =>
  ({
    currencyCode: 'USD',
    metrics: { marketValue: { value: '1000', status: 'verified' } },
    portfolios: [
      { id: 'one', name: 'One', broker: 'Broker A', accountType: 'Roth' },
      { id: 'two', name: 'Two', broker: 'Broker B', accountType: 'Taxable' },
    ],
    holdings: [
      {
        id: 'security',
        securityId: 'security',
        symbol: 'TEST',
        name: 'Test',
        marketValue: '1000',
        costBasis: '800',
        unrealizedGain: '200',
        averageCost: '8',
        price: '10',
        currencyCode: 'USD',
        priceDate: '2026-11-20',
        dailyChangePercent: '1',
        weight: '100',
        accounts: [
          {
            portfolioId: 'one',
            portfolioName: 'One',
            marketValue: '300',
            costBasis: '200',
            unrealizedGain: '100',
            averageCost: '6.66',
          },
          {
            portfolioId: 'two',
            portfolioName: 'Two',
            marketValue: '700',
            costBasis: '600',
            unrealizedGain: '100',
            averageCost: '8.57',
          },
        ],
      },
    ],
    exposure: [],
  }) as unknown as InvestmentAnalytics;
describe('portfolio heatmap grouping', () => {
  it('splits one combined security into its actual brokerage contributions', () => {
    const rows = investmentTreemapRows(fixture(), {
      grouping: 'brokerage',
      sizeBy: 'marketValue',
      colorBy: 'unrealized',
    });
    expect(rows.map((row) => [row.group, row.value, row.weight, row.change])).toEqual([
      ['Broker A', 300, 30, 50],
      ['Broker B', 700, 70, (100 / 600) * 100],
    ]);
    expect(rows.reduce((sum, row) => sum + row.size, 0)).toBe(1000);
  });
  it('uses the corresponding account basis when sizing by cost', () => {
    const rows = investmentTreemapRows(fixture(), { grouping: 'accountType', sizeBy: 'costBasis', colorBy: 'daily' });
    expect(rows.map((row) => [row.group, row.size, row.change])).toEqual([
      ['Roth', 200, 1],
      ['Taxable', 600, 1],
    ]);
  });
  it('splits indirect exposure using provenance instead of counting a wrapper again', () => {
    const analytics = fixture();
    analytics.exposure = [
      {
        id: 'company',
        symbol: 'CO',
        name: 'Company',
        totalValue: '100',
        directValue: '0',
        indirectValue: '100',
        weight: '10',
        sourceDate: '2026-11-01',
        contributions: [
          {
            portfolioId: 'one',
            portfolioName: 'One',
            fundId: 'fund',
            fundSymbol: 'ETF',
            value: '30',
            asOf: '2026-11-01',
          },
          {
            portfolioId: 'two',
            portfolioName: 'Two',
            fundId: 'fund',
            fundSymbol: 'ETF',
            value: '70',
            asOf: '2026-11-01',
          },
        ],
      },
    ] as InvestmentAnalytics['exposure'];
    const rows = investmentTreemapRows(analytics, {
      holdingsMode: 'underlying',
      grouping: 'brokerage',
      sizeBy: 'marketValue',
    });
    expect(rows.map((row) => [row.group, row.size])).toEqual([
      ['Broker A', 30],
      ['Broker B', 70],
    ]);
    expect(rows.reduce((sum, row) => sum + row.size, 0)).toBe(100);
    expect(investmentTreemapRows(analytics, { holdingsMode: 'underlying', sizeBy: 'costBasis' })).toEqual([]);
  });
});
