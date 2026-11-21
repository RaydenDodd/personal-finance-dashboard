import { easternDate, usEquitySession } from '@bt/shared/types/investment-market';
import { logger } from '@js/utils';
import { checkUnrealizedLossAlerts } from '@root/services/investments/holdings/check-unrealized-loss-alerts';
import {
  securitiesPricesStocksDailySync,
  securitiesPricesStocksIntradaySync,
} from '@root/services/investments/securities-price/securities-daily-sync.service';

import { createScheduledSync } from './lib/create-scheduled-sync';

export const securitiesIntradaySyncCron = createScheduledSync({
  name: 'securities intraday prices sync',
  cronExpression: '*/5 9-16 * * 1-5',
  timeZone: 'America/New_York',
  scheduleDescription: 'every 5 minutes during regular US equity sessions; holidays and early closes respected',
  run: (options?: { force?: boolean; securityIds?: string[] }) => securitiesPricesStocksIntradaySync(options),
});

/** One final quote after provider delay, so an intraday observation cannot hide the closing price. */
export const securitiesClosingSyncCron = createScheduledSync({
  name: 'securities closing prices sync',
  cronExpression: '20 13,16 * * 1-5',
  timeZone: 'America/New_York',
  scheduleDescription: 'one closing quote check 20 minutes after the regular or shortened session',
  run: async () => {
    const session = usEquitySession(easternDate());
    const hour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(
        new Date(),
      ),
    );
    return session.tradingDay && hour === session.closeMinute / 60
      ? securitiesPricesStocksIntradaySync({ force: true })
      : { skipped: 'not-the-session-close' };
  },
});

/**
 * Daily stock price sync — runs at 6:00 AM EST (after global markets close).
 *
 * Timing ensures:
 *   - US markets closed (4 PM EST previous day)
 *   - European markets closed (5:30 PM GMT previous day)
 *   - Asian markets closed (varies, but generally by 9 AM local time)
 */
export const securitiesDailySyncCron = createScheduledSync({
  name: 'securities daily prices sync',
  cronExpression: '0 6 * * *',
  timeZone: 'America/New_York',
  scheduleDescription: 'runs every day at 6:00 AM EST',
  // Loss alerts run after the sync so they compare against the prices it just stored.
  run: async () => {
    const syncResult = await securitiesPricesStocksDailySync();
    const lossAlerts = await checkUnrealizedLossAlerts().catch((error: unknown) => {
      logger.error(
        { message: 'Unrealized loss alert check failed', error: error as Error },
        { code: 'UNREALIZED_LOSS_ALERT_CHECK_FAILED' },
      );
      return null;
    });
    return {
      ...syncResult,
      ...(lossAlerts && {
        lossAlertsUsersChecked: lossAlerts.usersChecked,
        lossAlertsNotified: lossAlerts.notified,
        lossAlertsFailed: lossAlerts.failed,
      }),
    };
  },
});
