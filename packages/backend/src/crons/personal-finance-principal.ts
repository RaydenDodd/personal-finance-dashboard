import { logger } from '@js/utils/logger';
import { reconcileAllFinanceTransfers } from '@services/personal-finance/principal';
import { CronJob } from 'cron';

let running = false;
// This local ledger task also runs offline and never initiates a provider sync.
export const personalFinancePrincipalJob = new CronJob(
  '*/5 * * * *',
  () => {
    if (running) return;
    running = true;
    void reconcileAllFinanceTransfers()
      .catch(() => logger.error('Personal finance verified-transfer reconciliation failed'))
      .finally(() => {
        running = false;
      });
  },
  null,
  false,
  'America/New_York',
);
