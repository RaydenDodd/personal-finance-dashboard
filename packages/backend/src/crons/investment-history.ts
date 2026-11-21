import { withLock } from '@services/common/lock';
import { refreshNextAccountHistory } from '@services/investments/analytics/daily-account-cache';

import { createScheduledSync } from './lib/create-scheduled-sync';

export const investmentHistoryCron = createScheduledSync({
  name: 'investment daily account history',
  cronExpression: '*/10 * * * * *',
  timeZone: 'America/New_York',
  scheduleDescription: 'incremental account-history work in bounded, persisted chunks',
  run: withLock(
    'investment-daily-account-history',
    async (options?: { userId?: number; budgetMs?: number }) => {
      const deadline = Date.now() + Math.min(options?.budgetMs ?? 7000, 20000);
      let chunks = 0;
      do {
        if (!(await refreshNextAccountHistory(options?.userId))) break;
        chunks++;
        await new Promise((resolve) => setTimeout(resolve, 50));
      } while (Date.now() < deadline);
      return { chunks };
    },
    { ttl: 300 },
  ),
});
