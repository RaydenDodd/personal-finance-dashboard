import { ASSET_CLASS, SECURITY_PROVIDER } from '@bt/shared/types/investments';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { toProviderSymbol } from './base-provider';
import { fetchCoinbaseQuotes } from './coinbase-quotes';

const now = new Date('2026-11-20T08:00:00.000Z');
const input = {
  securityId: 'btc',
  symbol: 'BTC',
  providerSymbol: toProviderSymbol('bitcoin'),
  assetClass: ASSET_CLASS.crypto,
};
afterEach(() => {
  jest.restoreAllMocks();
});
describe('public crypto quote fallback', () => {
  it('uses verified identity and the actual market timestamp, echoing every holding identity', async () => {
    const mock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ price: '123.456', time: '2026-11-20T07:59:00Z' })));
    const quotes = await fetchCoinbaseQuotes([input, { ...input, securityId: 'btc-other' }], now);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]?.[0]).toBe('https://api.exchange.coinbase.com/products/BTC-USD/ticker');
    expect(quotes.get('btc')?.[0]).toMatchObject({
      priceClose: 123.456,
      providerName: SECURITY_PROVIDER.coinbase,
      date: new Date('2026-11-20T07:59:00Z'),
    });
    expect(quotes.get('btc-other')?.[0]?.securityId).toBe('btc-other');
  });
  it('does not guess from a colliding ticker or accept a non-crypto instrument', async () => {
    const mock = jest.spyOn(globalThis, 'fetch');
    expect(
      (
        await fetchCoinbaseQuotes(
          [
            { ...input, providerSymbol: toProviderSymbol('unverified-bitcoin') },
            { ...input, symbol: 'OTHER' },
            { ...input, assetClass: ASSET_CLASS.stocks },
          ],
          now,
        )
      ).size,
    ).toBe(0);
    expect(mock).not.toHaveBeenCalled();
  });
  it.each([
    { price: '0', time: now.toISOString() },
    { price: '123', time: '2023-01-01T00:00:00Z' },
    { price: 'NaN', time: now.toISOString() },
    { price: '123', time: '2026-11-21T00:00:00Z' },
  ])('retains no invalid, old or future quote: %p', async (quote) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(quote)));
    expect((await fetchCoinbaseQuotes([input], now)).size).toBe(0);
  });
  it('does not replace a failed request with a fabricated price', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 429 }));
    expect((await fetchCoinbaseQuotes([input], now)).size).toBe(0);
  });
});
