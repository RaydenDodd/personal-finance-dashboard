export function positionPeriodDates(today: string) {
  const end = new Date(today + 'T12:00:00Z');
  const monthly = (months: number) => {
    const date = new Date(end);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - months);
    date.setUTCDate(Math.min(day, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()));
    return date.toISOString().slice(0, 10);
  };
  const week = new Date(end);
  week.setUTCDate(week.getUTCDate() - 7);
  return {
    weekly: week.toISOString().slice(0, 10),
    monthly: monthly(1),
    '3m': monthly(3),
    '6m': monthly(6),
    ytd: new Date(Date.UTC(end.getUTCFullYear(), 0, 0)).toISOString().slice(0, 10),
    '1y': monthly(12),
    '2y': monthly(24),
    '5y': monthly(60),
  };
}

