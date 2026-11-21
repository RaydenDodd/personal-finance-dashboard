import {
  investmentPriceDate,
  usEquityCloseInstant,
  usEquityObservationAllowed,
} from '@bt/shared/types/investment-market';
import Big from 'big.js';

/** Restore original-share units from Yahoo's split-adjusted close. Dividends are never applied. */
export function originalShareClose(
  close: number,
  date: Date,
  splits: { date: Date; numerator: number; denominator: number }[],
) {
  let value = new Big(close);
  const day = investmentPriceDate(date);
  for (const split of splits) {
    if (investmentPriceDate(split.date) <= day) continue;
    if (
      !Number.isFinite(split.numerator) ||
      !Number.isFinite(split.denominator) ||
      split.numerator <= 0 ||
      split.denominator <= 0
    )
      throw new Error('Invalid split normalization data');
    value = value.times(split.numerator).div(split.denominator);
  }
  return value.toNumber();
}
/** Completed candles only. A candle starting at the close belongs to the extended session. */
export function candleCloseTime(start: Date, usSession: boolean, now = Date.now()) {
  if (usSession && !usEquityObservationAllowed(start)) return null;
  const sessionClose = usSession ? usEquityCloseInstant(investmentPriceDate(start)) : Infinity;
  if (usSession && start.getTime() >= sessionClose) return null;
  const end = new Date(Math.max(start.getTime(), Math.min(start.getTime() + 300000, sessionClose)));
  return end.getTime() <= now ? end : null;
}
