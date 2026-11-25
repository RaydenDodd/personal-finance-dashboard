import { canonicalSelection, readStatus, selectionKey } from './read-model';

describe('investment analytics durable read model', () => {
  const selection = { portfolioIds: ['b', 'a', 'a'], benchmarkSymbols: ['SPY'], hiddenPortfolioIds: ['c'] };

  it('normalizes duplicate and unordered selections', () => {
    expect(canonicalSelection(selection).portfolioIds).toEqual(['a', 'b']);
    expect(selectionKey(selection)).toBe(selectionKey({ ...selection, portfolioIds: ['a', 'b'] }));
  });

  it('isolates hidden settings, date ranges and benchmarks', () => {
    expect(selectionKey(selection)).not.toBe(selectionKey({ ...selection, hiddenPortfolioIds: [] }));
    expect(selectionKey(selection)).not.toBe(selectionKey({ ...selection, performanceFrom: '2026-01-01' }));
    expect(selectionKey(selection)).not.toBe(selectionKey({ ...selection, benchmarkSymbols: [] }));
  });

  it('distinguishes pending, ready, stale and failed refresh without inventing financial values', () => {
    const now = Date.parse('2026-11-25T12:00:00Z');
    expect(readStatus({ builtAt: null, failures: 0 }, now).state).toBe('pending');
    expect(readStatus({ builtAt: new Date(now), failures: 0 }, now).state).toBe('ready');
    expect(readStatus({ builtAt: new Date(now - 3600000), failures: 0 }, now).state).toBe('stale');
    expect(readStatus({ builtAt: new Date(now), failures: 1 }, now).state).toBe('retrying');
  });
});

import { omittedAnalyticsFields, investmentSectionForWidget } from '@bt/shared/types/investment-analytics-read';

describe('focused analytics payloads', () => {
  it('omits expensive look-through and overlap for holdings widgets', () => {
    expect(investmentSectionForWidget('heatmap')).toBe('holdings');
    expect(omittedAnalyticsFields('holdings')).toEqual(expect.arrayContaining(['exposure', 'overlap', 'history']));
    expect(omittedAnalyticsFields('holdings')).not.toContain('holdings');
  });
  it('keeps required sections for exposure, dividend and benchmark widgets', () => {
    expect(omittedAnalyticsFields(investmentSectionForWidget('dividends'))).not.toContain('dividends');
    expect(omittedAnalyticsFields(investmentSectionForWidget('sector'))).not.toContain('allocations');
    expect(omittedAnalyticsFields(investmentSectionForWidget('benchmark'))).not.toContain('benchmarks');
    expect(omittedAnalyticsFields('all')).toEqual([]);
  });
});

it('marks a persisted result stale on source revision changes', () => {
  const now = Date.now();
  expect(readStatus({ builtAt: new Date(now), failures: 0, sourceRevision: 'a' }, now, 'b').state).toBe('stale');
  expect(readStatus({ builtAt: new Date(now), failures: 0, sourceRevision: 'a' }, now, 'a').state).toBe('ready');
});
