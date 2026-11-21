/** NYSE regular equity sessions, including observed holidays and scheduled 1 pm closes.
 * Calendar rules verified against https://www.nyse.com/trade/hours-calendars (2026-11-20).
 * Unscheduled exchange closures cannot be predicted; provider timestamps remain authoritative.
 */
const easternDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export function easternDate(date = new Date()): string {
  return easternDateFormatter.format(date);
}
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
function nthWeekday(year: number, month: number, weekday: number, nth: number) {
  const first = new Date(Date.UTC(year, month, 1));
  return dayKey(new Date(Date.UTC(year, month, 1 + ((weekday - first.getUTCDay() + 7) % 7) + 7 * (nth - 1))));
}
function observed(year: number, month: number, day: number, precedingFriday = true) {
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCDay() === 0) date.setUTCDate(day + 1);
  else if (date.getUTCDay() === 6 && precedingFriday) date.setUTCDate(day - 1);
  return dayKey(date);
}
function goodFriday(year: number) {
  const a = year % 19,
    b = Math.floor(year / 100),
    c = year % 100,
    d = Math.floor(b / 4),
    e = b % 4;
  const f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4),
    k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451),
    n = h + l - 7 * m + 114;
  return dayKey(new Date(Date.UTC(year, Math.floor(n / 31) - 1, (n % 31) - 1)));
}
export function usEquitySession(date: string) {
  const year = Number(date.slice(0, 4)),
    weekday = new Date(date + 'T12:00:00Z').getUTCDay();
  const memorial = new Date(Date.UTC(year, 5, 0));
  memorial.setUTCDate(memorial.getUTCDate() - ((memorial.getUTCDay() + 6) % 7));
  const thanksgiving = nthWeekday(year, 10, 4, 4);
  const holidays = new Set([
    observed(year, 0, 1, false),
    nthWeekday(year, 0, 1, 3),
    nthWeekday(year, 1, 1, 3),
    goodFriday(year),
    dayKey(memorial),
    ...(year >= 2022 ? [observed(year, 5, 19)] : []),
    observed(year, 6, 4),
    nthWeekday(year, 8, 1, 1),
    thanksgiving,
    observed(year, 11, 25),
  ]);
  const tradingDay = weekday > 0 && weekday < 6 && !holidays.has(date);
  const friday = new Date(thanksgiving + 'T12:00:00Z');
  friday.setUTCDate(friday.getUTCDate() + 1);
  const earlyClose = tradingDay && (date === dayKey(friday) || date === `${year}-12-24` || date === `${year}-07-03`);
  return { date, tradingDay, openMinute: 570, closeMinute: earlyClose ? 780 : 960, earlyClose };
}
export function usEquityMarketOpen(now = new Date()) {
  const session = usEquitySession(easternDate(now));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const minute =
    Number(parts.find((p) => p.type === 'hour')?.value) * 60 + Number(parts.find((p) => p.type === 'minute')?.value);
  return session.tradingDay && minute >= session.openMinute && minute < session.closeMinute;
}
/** Daily bars are stored at UTC midnight; intraday observations retain their actual instant. */
export function investmentPriceDate(date: Date | string) {
  const value = new Date(date);
  return value.toISOString().endsWith('T00:00:00.000Z') ? dayKey(value) : easternDate(value);
}

export function previousUsEquitySession(date: string) {
  const previous = new Date(date + 'T12:00:00Z');
  do {
    previous.setUTCDate(previous.getUTCDate() - 1);
  } while (!usEquitySession(dayKey(previous)).tradingDay);
  return dayKey(previous);
}

/** Scheduled close, rather than the time a later quote request retrieved it. */
export function usEquityCloseInstant(date: string) {
  const noon = new Date(date + 'T12:00:00Z');
  const easternHour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(noon),
  );
  return (
    new Date(date + 'T00:00:00Z').getTime() + (usEquitySession(date).closeMinute + (12 - easternHour) * 60) * 60000
  );
}
