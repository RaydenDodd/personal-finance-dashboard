import { withLock } from '@services/common/lock';
import { refreshNextInvestmentReadModel } from '@services/investments/analytics/read-model';

import { createScheduledSync } from './lib/create-scheduled-sync';

export const investmentReadModelCron = createScheduledSync({
  name: 'investment analytics read models',
  cronExpression: '*/30 * * * * *',
  timeZone: 'America/New_York',
  scheduleDescription: 'one dirty or due persisted analytics selection per run',
  run: withLock('investment-analytics-read-model', async () => ({
    refreshed: await refreshNextInvestmentReadModel(),
  }), { ttl: 1800 }),
});
