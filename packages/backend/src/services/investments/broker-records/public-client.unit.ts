import { describe, it, expect, jest } from '@jest/globals';

import { PublicReadClient } from './public-client';

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
describe('Public read-only provider', () => {
  it('exchanges credentials only at the fixed authorization endpoint', async () => {
    const transport = jest.fn<typeof fetch>().mockResolvedValue(response({ accessToken: 'synthetic-token' }));
    const client = new PublicReadClient(transport);
    await client.authorize('synthetic-secret');
    expect(transport.mock.calls[0]![0]).toBe('https://api.public.com/userapiauthservice/personal/access-tokens');
    expect(transport.mock.calls[0]![1]).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(JSON.parse(String(transport.mock.calls[0]![1]!.body))).toEqual({
      secret: 'synthetic-secret',
      validityInMinutes: 15,
    });
  });
  it.each([
    '/userapigateway/trading/account/orders',
    '/userapigateway/trading/acct/orders',
    'https://example.com',
    '/userapigateway/trading/../account',
    '/userapigateway/trading/acct/portfolio/v2#orders',
  ])('rejects non-read endpoint %s before any network request', async (path) => {
    const transport = jest.fn<typeof fetch>();
    await expect(new PublicReadClient(transport).read(path)).rejects.toThrow('Unsupported');
    expect(transport).not.toHaveBeenCalled();
  });
  it('reads all history pages and never sends the secret on GETs', async () => {
    const transport = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ accessToken: 'synthetic-token' }))
      .mockResolvedValueOnce(response({ transactions: [], nextToken: 'next/page' }))
      .mockResolvedValueOnce(response({ transactions: [], nextToken: null }));
    const client = new PublicReadClient(transport);
    await client.authorize('synthetic-secret');
    expect(await client.history('acct')).toEqual([]);
    expect(transport.mock.calls[2]![0]).toContain('nextToken=next%2Fpage');
    expect(transport.mock.calls[1]![1]).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer synthetic-token' },
      redirect: 'error',
    });
    expect(transport.mock.calls[1]![1]?.body).toBeUndefined();
  });
  it('fails a repeated pagination token without treating partial history as complete', async () => {
    const transport = jest
      .fn<typeof fetch>()
      .mockImplementation(async () => response({ transactions: [], nextToken: 'repeat' }));
    await expect(new PublicReadClient(transport).history('acct')).rejects.toThrow('pagination');
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('does not echo provider error bodies or credentials', async () => {
    const transport = jest.fn<typeof fetch>().mockResolvedValue(response({ secret: 'must-not-leak' }, 401));
    await expect(new PublicReadClient(transport).authorize('must-not-leak')).rejects.toThrow(
      'Public authorization failed (HTTP 401).',
    );
  });
});
