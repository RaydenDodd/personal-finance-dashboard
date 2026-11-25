import type { InvestmentAccountHistoryResponse } from '@bt/shared/types/investment-history';
import type { PayrollRange } from '@/pages/income-management/payroll/date-range';

export function selectedPerformanceSummary(h: InvestmentAccountHistoryResponse | undefined, range: PayrollRange) {
  if (!h?.dates) return null;
  // Never relabel returns calculated from another opening date as the current period.
  if (h.gainFrom && range.preset !== 'all' && h.gainFrom !== range.from) return null;
  const i = h.dates.findLastIndex(
    (date, i) =>
      date.slice(0, 10) >= range.from && date.slice(0, 10) <= range.through && h.periodGains?.[i] != null,
  );
  if (i < 0) return null;
  const accounts = h.accounts ?? [];
  const gain = h.periodGains?.[i];
  const percent = h.periodReturnPercent?.[i];
  const partial = Boolean(h.pending || accounts.some((account) =>
    account.periodGains?.[i] == null || (percent != null && account.periodReturnPercent?.[i] == null) ||
    account.full?.[i] === false,
  ));
  return { gain, percent, partial, date: h.dates[i] };
}
