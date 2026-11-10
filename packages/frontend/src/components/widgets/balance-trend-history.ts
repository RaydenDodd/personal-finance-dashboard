import { differenceInDays, endOfMonth, isSameDay, parseISO, startOfMonth, subDays, subMonths } from 'date-fns';

export function previousBalanceTrendPeriod(period: { from: Date; to: Date }) {
  if (isSameDay(period.from, startOfMonth(period.from)) && isSameDay(period.to, endOfMonth(period.from))) {
    const previous = subMonths(period.from, 1);
    return { from: startOfMonth(previous), to: endOfMonth(previous) };
  }
  return {
    from: subDays(period.from, differenceInDays(period.to, period.from) + 1),
    to: subDays(period.from, 1),
  };
}

export function recordedBalanceTrendContext<T extends { date: string; historySource?: string }>(
  current: T[],
  previous: T[],
): { points: T[]; baseline?: T } {
  if (current.length !== 1 || current[0]!.historySource !== 'imported') return { points: current };
  const baseline = previous
    .filter((point) => point.historySource === 'imported' && point.date < current[0]!.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  return baseline ? { points: [baseline, ...current], baseline } : { points: current };
}

/** Date-only API observations represent local calendar dates, not UTC instants. */
export const balanceTrendObservationTime = (date: string): number => parseISO(date).getTime();
