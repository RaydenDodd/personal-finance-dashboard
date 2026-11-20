import { ASSET_CLASS, SECURITY_PROVIDER } from '@bt/shared/types/investments';
import { logger } from '@js/utils';

import { BulkPriceData, SecurityPriceFetchInput } from './base-provider';

// Match verified identities, never just a ticker (crypto symbols are not unique).
const products: Record<string, { symbol: string; product: string }> = {
  bitcoin: { symbol: 'BTC', product: 'BTC-USD' },
  ethereum: { symbol: 'ETH', product: 'ETH-USD' },
  'ethereum-classic': { symbol: 'ETC', product: 'ETC-USD' },
  dogecoin: { symbol: 'DOGE', product: 'DOGE-USD' },
  'avalanche-2': { symbol: 'AVAX', product: 'AVAX-USD' },
};

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
