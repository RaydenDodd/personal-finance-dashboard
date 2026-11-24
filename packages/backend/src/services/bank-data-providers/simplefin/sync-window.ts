import { subDays } from 'date-fns';

/** Fetch checkpoints, not transaction dates, advance the polling cursor. Empty accounts still advance. */
export function simplefinSyncStart({
  to,
  anchor,
  fetchedAt,
  linkedAt,
  backfillDays = 90,
}: {
  to: Date;
  anchor: Date | null;
  fetchedAt?: Date | null;
  linkedAt?: Date | null;
  backfillDays?: number;
}): Date {
  const valid = (d?: Date | null): d is Date => !!d && Number.isFinite(d.getTime()) && d <= to;
  const cursor = valid(fetchedAt) ? fetchedAt : valid(anchor) ? anchor : null;
  const from = cursor ? subDays(cursor, 5) : subDays(to, backfillDays);
  return valid(linkedAt) && linkedAt > from ? linkedAt : from;
}
