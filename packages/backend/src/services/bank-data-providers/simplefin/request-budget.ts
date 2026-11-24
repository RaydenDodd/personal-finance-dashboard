import { TooManyRequests, ServiceUnavailableError } from '@js/errors';
import { redisClient } from '@root/redis-client';
import { createHash, randomUUID } from 'node:crypto';

// Atomic across workers, users sharing an access token, retries, and restarts. No credentials in keys/logs.
const RESERVE = `
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 86400000)
local count = redis.call('ZCARD', KEYS[1])
if count >= 24 then return 0 end
redis.call('ZADD', KEYS[1], now, ARGV[2])
redis.call('PEXPIRE', KEYS[1], 86400000)
return count + 1
`;
export async function reserveSimplefinRequest(accessUrl: string, accountId?: string): Promise<number> {
  const fingerprint = createHash('sha256').update(accessUrl).digest('hex');
  const scope = accountId ? createHash('sha256').update(accountId).digest('hex') : 'all';
  let count: number;
  try {
    count = Number(
      await redisClient.eval(RESERVE, 1, `simplefin:requests:${fingerprint}:${scope}`, Date.now(), randomUUID()),
    );
  } catch {
    throw new ServiceUnavailableError({ message: 'SimpleFIN request budget is unavailable. Retry later.' });
  }
  if (!count)
    throw new TooManyRequests({
      message: 'SimpleFIN daily request budget reached (24 requests). Please wait before syncing again.',
    });
  return count;
}
