import { syncDuePublic } from '@services/investments/broker-records/public-sync';

import { createScheduledSync } from './lib/create-scheduled-sync';

export const publicPortfolioSyncCron = createScheduledSync({
  name: 'Public read-only portfolio sync',
  cronExpression: '*/5 * * * *',
  timeZone: 'UTC',
  scheduleDescription: 'checks every five minutes; each connection syncs every six hours, including after restarts',
  errorCode: 'PUBLIC_PORTFOLIO_SYNC',
  run: syncDuePublic,
});
