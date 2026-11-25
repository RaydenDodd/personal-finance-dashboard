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
    expect(readStatus({ builtAt: new Date(now - 300000), failures: 0 }, now).state).toBe('stale');
    expect(readStatus({ builtAt: new Date(now), failures: 1 }, now).state).toBe('retrying');
  });
});
