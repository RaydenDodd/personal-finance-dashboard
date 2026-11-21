import type { CompositionImportAttempt } from '@models/investments/fund-holdings-snapshot.model';

import { compositionRefreshDue, compositionRetryDelay } from './cadence';
const attempt = (status: CompositionImportAttempt['status'], error?: string): CompositionImportAttempt => ({
  kind: 'import-attempt',
  fundId: 'fund',
  symbol: 'FUND',
  sourceId: 'sec-nport',
  attemptedAt: '2026-11-20T12:00:00Z',
  status,
  error,
});
describe('SEC background refresh cadence', () => {
  it('keeps successful sources on weekly polling', () => {
    expect(compositionRetryDelay(attempt('duplicate'))).toBe(7 * 86400000);
    expect(
      compositionRefreshDue(attempt('duplicate'), '2026-11-20T13:00:00Z', Date.parse('2026-11-20T13:00:00Z')),
    ).toBe(false);
  });
  it('retries a transient failure when due or explicitly re-enabled', () => {
    const failed = attempt('failed', 'SEC returned HTTP 503; last usable composition retained.');
    expect(compositionRefreshDue(failed, '2026-11-19T12:00:00Z', Date.parse('2026-11-20T12:30:00Z'))).toBe(false);
    expect(compositionRefreshDue(failed, '2026-11-20T12:30:00Z', Date.parse('2026-11-20T12:30:00Z'))).toBe(true);
    expect(compositionRefreshDue(failed, '2026-11-19T12:00:00Z', Date.parse('2026-11-20T13:00:00Z'))).toBe(true);
  });
  it('honors 403/429 cooldowns even after re-enabling', () => {
    for (const error of [
      'SEC returned HTTP 403',
      'SEC returned HTTP 429',
      'SEC access is paused after an access restriction',
    ]) {
      expect(compositionRetryDelay(attempt('failed', error))).toBe(86400000);
      expect(
        compositionRefreshDue(attempt('failed', error), '2026-11-20T13:00:00Z', Date.parse('2026-11-20T13:00:00Z')),
      ).toBe(false);
    }
  });
});
