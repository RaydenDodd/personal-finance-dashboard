import { ForbiddenError, ServiceUnavailableError, TooManyRequests } from '@js/errors';
import { logger } from '@js/utils/logger';
import axios, { AxiosInstance } from 'axios';
import { setTimeout as delay } from 'node:timers/promises';

import { SimplefinApiClient } from './api-client';
import { reserveSimplefinRequest } from './request-budget';

jest.mock('./request-budget', () => ({ reserveSimplefinRequest: jest.fn().mockResolvedValue(1) }));
jest.mock('node:timers/promises', () => ({ setTimeout: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@i18n/index', () => ({ t: ({ key }: { key: string }) => key }));
jest.mock('@js/utils/logger', () => ({ logger: { info: jest.fn() } }));
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    post: jest.fn(),
    isAxiosError: (error: { isAxiosError?: boolean }) => error?.isAxiosError === true,
  },
}));

const transportError = ({ status, code }: { status?: number; code?: string }) =>
  Object.assign(new Error('https://test-user:private-password@example.invalid/access'), {
    isAxiosError: true,
    response: status === undefined ? undefined : { status },
    code,
  });

describe('SimpleFIN GET transport retry', () => {
  const get = jest.fn();
  const accountSet = { accounts: [], errors: [] };

  beforeEach(() => {
    jest.clearAllMocks();
    get.mockReset();
    jest.mocked(axios.create).mockReturnValue({ get } as unknown as AxiosInstance);
  });

  it.each(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'])(
    'retries one %s GET with identical query parameters',
    async (code) => {
      get.mockRejectedValueOnce(transportError({ code })).mockResolvedValueOnce({ data: accountSet });
      const client = new SimplefinApiClient('https://test-user:private-password@example.invalid/access');
      expect(await client.getAccounts({ startDate: new Date('2026-11-01Z'), balancesOnly: true })).toBe(accountSet);
      expect(get).toHaveBeenCalledTimes(2);
      expect(reserveSimplefinRequest).toHaveBeenCalledTimes(2);
      expect(get.mock.calls[1]).toEqual(get.mock.calls[0]);
      expect(delay).toHaveBeenCalledTimes(1);
      expect(delay).toHaveBeenCalledWith(500);
      expect(JSON.stringify(jest.mocked(logger.info).mock.calls)).not.toContain('private-password');
    },
  );

  it.each([502, 503, 504])('retries one HTTP %i GET', async (status) => {
    get.mockRejectedValueOnce(transportError({ status })).mockResolvedValueOnce({ data: accountSet });
    expect(await new SimplefinApiClient('https://user:pass@example.invalid/access').getAccounts()).toBe(accountSet);
    expect(get).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 429, 400, 404, 500])(
    'does not retry HTTP %i even if it also has a timeout code',
    async (status) => {
      get.mockRejectedValue(transportError({ status, code: 'ECONNABORTED' }));
      await expect(new SimplefinApiClient('https://user:pass@example.invalid/access').getAccounts()).rejects.toThrow();
      expect(get).toHaveBeenCalledTimes(1);
      expect(delay).not.toHaveBeenCalled();
    },
  );

  it('stops after the second transient failure and keeps the typed outage error', async () => {
    get.mockRejectedValue(transportError({ code: 'ECONNABORTED' }));
    await expect(
      new SimplefinApiClient('https://user:pass@example.invalid/access').getAccounts(),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(get).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(jest.mocked(logger.info).mock.calls)).not.toContain('private-password');
  });

  it.each([
    [401, ForbiddenError],
    [403, ForbiddenError],
    [429, TooManyRequests],
  ])('preserves the mapped HTTP %i error', async (status, errorType) => {
    get.mockRejectedValue(transportError({ status: status as number }));
    await expect(
      new SimplefinApiClient('https://user:pass@example.invalid/access').getAccounts(),
    ).rejects.toBeInstanceOf(errorType);
  });

  it('never retries the single-use claim POST', async () => {
    const error = transportError({ code: 'ECONNABORTED' });
    jest.mocked(axios.post).mockRejectedValueOnce(error);
    await expect(
      SimplefinApiClient.claimAccessUrl(Buffer.from('https://example.invalid/claim').toString('base64')),
    ).rejects.toBe(error);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(delay).not.toHaveBeenCalled();
  });
  it('refuses a >90-day request before contacting the provider', async () => {
    await expect(
      new SimplefinApiClient('https://user:pass@example.invalid/access').getAccounts({
        startDate: new Date('2026-01-01Z'),
        endDate: new Date('2026-05-01Z'),
      }),
    ).rejects.toThrow('90 days');
    expect(get).not.toHaveBeenCalled();
  });
  it('does not retry or call the provider after the request budget is exhausted', async () => {
    jest.mocked(reserveSimplefinRequest).mockRejectedValueOnce(new TooManyRequests({ message: 'Budget reached' }));
    await expect(new SimplefinApiClient('https://user:pass@example.invalid/access').getAccounts()).rejects.toThrow(
      'Budget reached',
    );
    expect(get).not.toHaveBeenCalled();
  });
});
