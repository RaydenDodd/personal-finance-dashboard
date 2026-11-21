import type { InvestmentFundSnapshot } from '@bt/shared/types/investment-analytics';

import { isCompanyExposure } from '../analytics/math';
import { bridgeCompositionIdentities } from './identities';

const snapshot = (name = 'Microsoft Corp'): InvestmentFundSnapshot => ({
  fundId: 'fund',
  symbol: 'FUND',
  asOf: '2026-06-30',
  provider: 'issuer',
  retrievedAt: '2026-11-20T00:00:00Z',
  coverage: '10',
  holdings: [
    {
      id: 'cusip:594918104',
      cusip: '594918104',
      symbol: 'MSFT',
      name,
      weight: '10',
      assetClass: 'Equity',
      currencyCode: 'USD',
      country: 'US',
    },
  ],
  provenance: {
    sourceId: 'ssga-xlsx',
    sourceUrl: 'https://www.ssga.com/source.xlsx',
    fileName: 'source.xlsx',
    sha256: '0'.repeat(64),
    parserVersion: '1',
    method: 'issuer-file',
    reportedRowCount: 1,
    parsedRowCount: 1,
    unweightedRowCount: 0,
    completeness: 'partial',
    warnings: [],
    netWeight: '10',
    grossWeight: '10',
    residualWeight: '90',
    autoRefreshPermitted: false,
  },
});
describe('verified source identifier bridges', () => {
  const native = {
    id: 'native-microsoft',
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    currencyCode: 'USD',
    exchangeAcronym: 'NMS',
  };
  it('joins source CUSIP to an unambiguous native issuer/listing without editing either input', () => {
    const input = snapshot();
    const result = bridgeCompositionIdentities([input], [native]);
    expect(result[0]!.holdings[0]).toMatchObject({ id: 'native-microsoft', sourceId: 'cusip:594918104' });
    expect(input.holdings[0]!.id).toBe('cusip:594918104');
    expect(native).not.toHaveProperty('cusip');
  });
  it('does not merge ticker-only, issuer-mismatched, foreign-currency or ambiguous listings', () => {
    for (const securities of [
      [{ ...native, name: 'Unrelated company' }],
      [{ ...native, currencyCode: 'CAD' }],
      [{ ...native, exchangeAcronym: 'UNKNOWN' }],
      [native, { ...native, id: 'other-native' }],
    ])
      expect(bridgeCompositionIdentities([snapshot()], securities)[0]!.holdings[0]!.id).toBe('cusip:594918104');
    const unverified = { ...snapshot(), provenance: undefined };
    expect(bridgeCompositionIdentities([unverified], [native])[0]!.holdings[0]!.id).toBe('cusip:594918104');
  });
  it('keeps non-company assets out of company concentration and overlap', () => {
    for (const assetClass of [
      'Derivative',
      'Commodity',
      'Cash / short-term investment',
      'Liabilities',
      'Repurchase agreement',
    ])
      expect(isCompanyExposure({ assetClass, unknown: false })).toBe(false);
    expect(isCompanyExposure({ assetClass: 'Equity', unknown: false })).toBe(true);
    expect(isCompanyExposure({ assetClass: 'Equity', unknown: true })).toBe(false);
  });
});
