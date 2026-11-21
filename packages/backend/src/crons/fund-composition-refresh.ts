import { runDueCompositionRefreshes } from '@services/investments/composition/scheduler';

import { createScheduledSync } from './lib/create-scheduled-sync';

export const fundCompositionRefreshCron = createScheduledSync({
  name: 'fund composition disclosure refresh',
  cronExpression: '15 7 * * *',
  timeZone: 'America/New_York',
  scheduleDescription: 'checks due SEC disclosures at 07:15 America/New_York; weekly per enabled visible fund',
  run: runDueCompositionRefreshes,
});
