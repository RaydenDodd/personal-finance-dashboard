import type { InvestmentAnalytics } from '@bt/shared/types/investment-analytics';
import { it, expect } from 'vitest';

import { allocationDrilldown } from './allocation-drilldown';
it('keeps ETFs intact at the root and uses only that fund?s recorded contributions on drilldown', () => {
  const analytics = {
    allocations: { holdings: [{ key: 'voo', label: 'VOO', value: '1000', percent: '50', securityIds: ['voo'] }] },
    holdings: [{ id: 'voo', isFund: true }],
    exposure: [
      {
        id: 'nvda',
        symbol: 'NVDA',
        unknown: false,
        contributions: [
          { fundId: 'voo', value: '70' },
          { fundId: 'qqq', value: '120' },
          { fundId: null, value: '50' },
        ],
      },
      { id: 'unknown', name: 'Unreported holdings', unknown: true, contributions: [{ fundId: 'voo', value: '930' }] },
    ],
  } as unknown as InvestmentAnalytics;
  const tree = allocationDrilldown(analytics, 'holdings');
  expect(tree[0]?.name).toBe('VOO');
  expect(tree[0]?.amount).toBe(1000);
  expect(tree[0]?.children?.find((c) => c.id === 'nvda')?.amount).toBe(70);
  expect(tree[0]?.children?.reduce((sum, c) => sum + c.amount, 0)).toBe(1000);
  const before = structuredClone(analytics);
  allocationDrilldown(analytics, 'holdings');
  expect(analytics).toEqual(before);
});
