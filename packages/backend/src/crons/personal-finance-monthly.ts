import { logger } from '@js/utils/logger';
import { recordFinanceMonthlyRuns } from '@services/personal-finance';
import { CronJob } from 'cron';

// Local bookkeeping runs offline as well. No request to a bank is made here.
export const personalFinanceMonthlyJob = new CronJob('15 1 * * *', () => {
  void recordFinanceMonthlyRuns().catch(() => logger.error('Personal finance monthly completeness check failed'));
}, null, false, 'America/New_York');
