// Dedicated process for expensive investment analytics. No HTTP server,
// bank sync listeners, or duplicate migration runner.
import './bootstrap';
import './models';
import { logger } from '@js/utils/logger';
import { redisReady } from './redis-client';
import { investmentHistoryCron } from './crons/investment-history';
import { investmentReadModelCron } from './crons/investment-read-model';
import { initializeExchangeRateProviders } from './services/exchange-rates/providers';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => { stopping = true; });
}

async function main() {
  if (process.env.INVESTMENT_WORKER_ROLE !== 'true') {
    throw new Error('Investment worker must be started with INVESTMENT_WORKER_ROLE=true');
  }
  await redisReady;
  initializeExchangeRateProviders();
  logger.info('Dedicated investment analytics worker started');
  const heartbeat = () => writeFileSync('/tmp/investment-worker-heartbeat', String(Date.now()));
  let nextHistory = 0;
  heartbeat();
  while (!stopping) {
    let didWork = false;
    // A busy or stale history lock must never suppress read-model processing.
    // Serve requested analytics first, then allow bounded history work.
    try {
      const analytics = await investmentReadModelCron.triggerManualSync();
      didWork = analytics.refreshed;
    } catch (error) {
      logger.warn('Investment read-model worker pass failed; will retry', {
        errorType: error instanceof Error ? error.name : 'unknown',
      });
    }
    if (!stopping && Date.now() >= nextHistory) {
      nextHistory = Date.now() + 15000;
      try {
        const history = await investmentHistoryCron.triggerManualSync();
        didWork = history.chunks > 0 || didWork;
      } catch (error) {
        logger.warn('Investment history worker pass failed; will retry', {
          errorType: error instanceof Error ? error.name : 'unknown',
        });
      }
    }
    heartbeat();
    if (!stopping) await sleep(didWork ? 2000 : 5000);
  }
  logger.info('Dedicated investment analytics worker stopped');
}

void main().then(() => process.exit(0)).catch((error) => {
  logger.error({ message: 'Investment worker failed to start', error });
  process.exit(1);
});
