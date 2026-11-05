import type { FinanceAccount, FinanceHistoryPoint } from '@/api/personal-finance';
import { describe, expect, it } from 'vitest';

import { recordedCategoryBalance, recordedNetWorth } from './history-display';

const point: FinanceHistoryPoint = {
  date: '2022-06-15',
  total: null,
  knownTotal: 125.25,
  categories: { savings: 125.25 },
  missingAccountIds: ['b'],
  complete: false,
  balances: { a: 125.25, b: null },
};
const accounts = [
  { id: 'a', included: true, categoryId: 'savings' },
  { id: 'b', included: true, categoryId: 'savings' },
] as FinanceAccount[];
describe('recorded history display', () => {
  it('shows early partial observations instead of hiding their recorded subtotal', () => {
    expect(recordedNetWorth(point)).toBe(125.25);
    expect(point.total).toBeNull();
    expect(point.balances.b).toBeNull();
    expect(recordedCategoryBalance(point, accounts, 'savings')).toBe(125.25);
  });
  it('keeps entirely unavailable categories missing and empty categories at zero', () => {
    expect(
      recordedCategoryBalance({ ...point, categories: {}, balances: { a: null, b: null } }, accounts, 'savings'),
    ).toBeNull();
    expect(recordedCategoryBalance(point, accounts, 'retirement')).toBe(0);
  });
  it('preserves actual zero and complete totals', () => {
    expect(recordedNetWorth({ ...point, total: 0, knownTotal: 0, complete: true })).toBe(0);
  });
});
