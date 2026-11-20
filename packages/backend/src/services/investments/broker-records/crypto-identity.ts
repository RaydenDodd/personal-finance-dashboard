import { ASSET_CLASS, SECURITY_PROVIDER, type SecuritySearchResult } from '@bt/shared/types/investments';
import { z } from 'zod';

const coinsSchema = z.array(z.object({ id: z.string(), symbol: z.string(), name: z.string() })).max(50000);
type Coin = z.infer<typeof coinsSchema>[number];
export const matchCryptoIdentity = (coins: Coin[], symbol: string, name?: string | null): SecuritySearchResult => {
  if (!name) throw new Error('A verified crypto identity is required.');
  const matches = coins.filter(
    (c) => c.symbol.toUpperCase() === symbol.toUpperCase() && c.name.toLowerCase() === name.toLowerCase(),
  );
  if (matches.length !== 1) throw new Error('A unique verified crypto identity is required.');
  const coin = matches[0]!;
  return {
    symbol: coin.symbol.toUpperCase(),
    name: coin.name,
    providerName: SECURITY_PROVIDER.coingecko,
    providerSymbol: coin.id,
    assetClass: ASSET_CLASS.crypto,
    currencyCode: 'USD',
    cryptoCurrencyCode: coin.symbol.toUpperCase(),
  };
};

/** Identity metadata only; broker snapshots supply prices when the optional quote provider is unconfigured. */
export const resolveBrokerCryptoIdentity = async (symbol: string, name?: string | null) => {
  const response = await fetch('https://api.coingecko.com/api/v3/coins/list?include_platform=false', {
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Crypto identity directory is unavailable.');
  return matchCryptoIdentity(coinsSchema.parse(await response.json()), symbol, name);
};
