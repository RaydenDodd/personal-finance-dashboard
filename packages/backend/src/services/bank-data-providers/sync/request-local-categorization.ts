import { logger } from '@js/utils';
import { redisClient } from '@root/redis-client';

/** Durable notification to the owner's local classifier; no cloud inference. */
export async function requestLocalCategorization(userId: number): Promise<void> {
  if (process.env.FINANCE_LOCAL_CATEGORIZATION !== 'true') return;
  try {
    await redisClient.set(`finance:local-categorization:pending:${userId}`, new Date().toISOString());
  } catch {
    logger.warn('Unable to notify local categorizer; the nightly job remains available');
  }
}
