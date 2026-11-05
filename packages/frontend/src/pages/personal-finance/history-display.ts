import type { FinanceAccount, FinanceHistoryPoint } from '@/api/personal-finance';

/** A partial point shows only recorded money; missing accounts remain null in the data. */
export const recordedNetWorth = (point: FinanceHistoryPoint): number | null => point.total ?? point.knownTotal ?? null;

export function recordedCategoryBalance(
  point: FinanceHistoryPoint,
  accounts: FinanceAccount[],
  categoryId: string,
): number | null {
  const members = accounts.filter((a) => a.included && a.categoryId === categoryId);
  if (!members.length) return 0;
  if (!members.some((a) => point.balances[a.id] !== null && point.balances[a.id] !== undefined)) return null;
  return point.categories[categoryId] ?? null;
}
