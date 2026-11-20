import { describe, expect, it } from '@jest/globals';

import { matchCryptoIdentity } from './crypto-identity';
describe('Broker crypto identity', () => {
  const coins = [
    { id: 'example-coin', symbol: 'EXM', name: 'Example Coin' },
    { id: 'unrelated-coin', symbol: 'EXM', name: 'Unrelated Coin' },
  ];
  it('requires both broker name and symbol and uses the provider identifier', () => {
    expect(matchCryptoIdentity(coins, 'EXM', 'Example Coin')).toMatchObject({
      providerName: 'coingecko',
      providerSymbol: 'example-coin',
      symbol: 'EXM',
    });
  });
  it('does not guess from an ambiguous ticker alone', () => {
    expect(() => matchCryptoIdentity(coins, 'EXM')).toThrow();
  });
  it('does not invent a missing identity', () => {
    expect(() => matchCryptoIdentity(coins, 'EXM', 'Missing Coin')).toThrow();
  });
});
