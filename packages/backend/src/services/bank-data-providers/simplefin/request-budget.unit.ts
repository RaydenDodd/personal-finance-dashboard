import { redisClient } from '@root/redis-client';

import { reserveSimplefinRequest } from './request-budget';
jest.mock('@root/redis-client', () => ({ redisClient: { eval: jest.fn() } }));
describe('SimpleFIN daily request budget', () => {
  beforeEach(() => jest.clearAllMocks());
  it('shares an atomic 24-request budget by credential and endpoint scope without disclosing secrets', async () => {
    jest.mocked(redisClient.eval).mockResolvedValue(24);
    await expect(reserveSimplefinRequest('https://user:secret@host/access')).resolves.toBe(24);
    const key = jest.mocked(redisClient.eval).mock.calls[0]![2] as string;
    expect(key).toContain('simplefin:requests:');
    expect(key).not.toContain('secret');
    jest.mocked(redisClient.eval).mockResolvedValue(0);
    await expect(reserveSimplefinRequest('https://user:secret@host/access')).rejects.toThrow('24 requests');
  });
  it('does not make an unmetered request if Redis is unavailable', async () => {
    jest.mocked(redisClient.eval).mockRejectedValue(new Error('offline'));
    await expect(reserveSimplefinRequest('https://user:secret@host/access')).rejects.toThrow('budget is unavailable');
  });
});
