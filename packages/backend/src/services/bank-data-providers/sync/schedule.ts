export function nextBankSyncAt(hours: number[], now = new Date()): number | null {
  const candidates = hours
    .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23)
    .map((hour) => {
      const date = new Date(now);
      date.setUTCHours(hour, 0, 0, 0);
      if (date.getTime() <= now.getTime()) date.setUTCDate(date.getUTCDate() + 1);
      return date.getTime();
    });
  return candidates.length ? Math.min(...candidates) : null;
}
