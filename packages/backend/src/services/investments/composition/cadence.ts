import type { CompositionImportAttempt } from '@models/investments/fund-holdings-snapshot.model';

export function compositionRetryDelay(attempt: Pick<CompositionImportAttempt, 'status' | 'error'>) {
  if (['imported', 'duplicate'].includes(attempt.status)) return 7 * 86400000;
  if (/HTTP (?:403|429)|access is paused/i.test(attempt.error ?? '')) return 86400000;
  return 3600000;
}
export function compositionRefreshDue(
  previous: CompositionImportAttempt | undefined,
  configuredAt: string,
  now: number,
) {
  if (!previous) return true;
  if (now - Date.parse(previous.attemptedAt) >= compositionRetryDelay(previous)) return true;
  // Re-enabling retries transient failures; restrictions retain their cooldown.
  return (
    !['imported', 'duplicate'].includes(previous.status) &&
    compositionRetryDelay(previous) < 86400000 &&
    configuredAt > previous.attemptedAt
  );
}
