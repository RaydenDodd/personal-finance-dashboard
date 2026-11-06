import { runAllSheetSyncs } from '@services/personal-finance/sheets-sync';

import { createScheduledSync } from './lib/create-scheduled-sync';

export const personalFinanceSheetsCron = createScheduledSync({
  name: 'personal finance Google Sheets synchronization',
  cronExpression: '*/5 * * * *',
  timeZone: 'America/New_York',
  scheduleDescription: 'every five minutes when enabled and authorized',
  errorCode: 'PERSONAL_FINANCE_SHEETS',
  run: runAllSheetSyncs,
});
