import { withInvestmentJobLock } from './lib/investment-job-lock';
import { refreshNextInvestmentReadModel } from '@services/investments/analytics/read-model';

import { createScheduledSync } from './lib/create-scheduled-sync';

export const investmentReadModelCron = createScheduledSync({
  name: 'investment analytics read models',
  cronExpression: '*/15 * * * * *',
  timeZone: 'America/New_York',
  scheduleDescription: 'one dirty or due persisted analytics selection per run',
  run: withInvestmentJobLock('read-model', async () => ({
    refreshed: await refreshNextInvestmentReadModel(),
  })),
});
