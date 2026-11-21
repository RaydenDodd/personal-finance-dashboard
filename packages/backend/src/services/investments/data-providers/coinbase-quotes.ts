import { ASSET_CLASS, SECURITY_PROVIDER } from '@bt/shared/types/investments';
import { logger } from '@js/utils';

import { BulkPriceData, SecurityPriceFetchInput, PriceData } from './base-provider';

// Match verified identities, never just a ticker (crypto symbols are not unique).
const products: Record<string, { symbol: string; product: string }> = {
  bitcoin: { symbol: 'BTC', product: 'BTC-USD' },
  ethereum: { symbol: 'ETH', product: 'ETH-USD' },
  'ethereum-classic': { symbol: 'ETC', product: 'ETC-USD' },
  dogecoin: { symbol: 'DOGE', product: 'DOGE-USD' },
  'avalanche-2': { symbol: 'AVAX', product: 'AVAX-USD' },
  'shiba-inu': { symbol: 'SHIB', product: 'SHIB-USD' },
};

/** Bounded daily-candle fallback in the existing public Coinbase integration.
 * https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles
 * Each request covers at most 300 buckets. No trades or account data are requested.
 */
export async function fetchCoinbaseHistory(
  input: SecurityPriceFetchInput,
  start: Date,
  end: Date,
  granularity: 3600 | 86400 = 86400,
): Promise<PriceData[]> {
  const identity = products[input.providerSymbol];
  if (input.assetClass !== ASSET_CLASS.crypto || !identity || identity.symbol !== input.symbol) return [];
  const points = new Map<number, PriceData>();
  const through = Math.min(end.getTime(), Date.now());
  const bucketMs = granularity * 1000;
  for (let from = start.getTime(); from < through; from += 299 * bucketMs) {
    const url = new URL(`https://api.exchange.coinbase.com/products/${identity.product}/candles`);
    url.search = new URLSearchParams({
      granularity: String(granularity),
      start: new Date(from).toISOString(),
      end: new Date(Math.min(through, from + 299 * bucketMs)).toISOString(),
    }).toString();
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Coinbase history HTTP ${response.status}`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error('Invalid Coinbase candle response');
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 6) continue;
      const time = Number(row[0]) * 1000,
        close = Number(row[4]);
      if (
        !Number.isFinite(time) ||
        time < start.getTime() - bucketMs ||
        time + bucketMs > through ||
        !Number.isFinite(close) ||
        close <= 0
      )
        continue;
      const date = new Date(granularity === 86400 ? time : time + bucketMs);
      points.set(time, {
        providerSymbol: input.providerSymbol,
        providerName: SECURITY_PROVIDER.coinbase,
        date,
        priceAsOf: new Date(time + bucketMs),
        priceClose: close,
        unadjustedClose: close,
        dailyBar: granularity === 86400,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return [...points.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Public market quotes only. No account, credential, order or historical backfill endpoints. */
export const fetchCoinbaseQuotes = async (
  inputs: SecurityPriceFetchInput[],
  now = new Date(),
): Promise<Map<string, BulkPriceData[]>> => {
  const results = new Map<string, BulkPriceData[]>();
  const byProduct = new Map<string, SecurityPriceFetchInput[]>();
  for (const input of inputs) {
    const identity = products[input.providerSymbol];
    if (input.assetClass !== ASSET_CLASS.crypto || !identity || identity.symbol !== input.symbol) continue;
    byProduct.set(identity.product, [...(byProduct.get(identity.product) ?? []), input]);
  }
  for (const [product, securities] of byProduct) {
    try {
      const response = await fetch(`https://api.exchange.coinbase.com/products/${product}/ticker`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const quote = (await response.json()) as { price?: unknown; time?: unknown };
      const price = typeof quote.price === 'string' ? Number(quote.price) : NaN;
      const asOf = new Date(typeof quote.time === 'string' ? quote.time : NaN);
      const age = now.getTime() - asOf.getTime();
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(age) || age < -60000 || age > 3600000)
        throw new Error('Invalid or stale market quote');
      for (const input of securities)
        results.set(input.securityId, [
          {
            securityId: input.securityId,
            providerSymbol: input.providerSymbol,
            providerName: SECURITY_PROVIDER.coinbase,
            priceClose: price,
            priceAsOf: asOf,
            date: asOf,
          },
        ]);
    } catch (error) {
      logger.warn(
        `Public crypto quote unavailable for ${product}: ${error instanceof Error ? error.message : 'request failed'}`,
      );
    }
  }
  return results;
};
