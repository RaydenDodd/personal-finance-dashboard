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
  it('keeps HEICO common and Class A securities distinct across issuer ticker punctuation', () => {
    const base = snapshot();
    const common = {
      id: 'cusip:422806109',
      cusip: '422806109',
      symbol: '422806109',
      name: 'HEICO CORP',
      weight: '1',
      assetClass: 'Equity',
      currencyCode: 'USD',
    };
    const classA = {
      ...common,
      id: 'cusip:422806208',
      cusip: '422806208',
      symbol: 'HEI/A',
      name: 'HEICO CORP CLASS A',
    };
    const issuer = {
      ...base,
      fundId: 'issuer',
      holdings: [
        {
          id: 'listing:NYSE:USD:HEI',
          symbol: 'HEI',
          name: 'HEICO CORP',
          weight: '0.46',
          assetClass: 'Equity',
          currencyCode: 'USD',
          exchange: 'NYSE',
        },
        {
          id: 'listing:NYSE:USD:HEI A',
          symbol: 'HEI A',
          name: 'HEICO CLASS A',
          weight: '0.61',
          assetClass: 'Equity',
          currencyCode: 'USD',
          exchange: 'NYSE',
        },
      ],
    };
    const result = bridgeCompositionIdentities([{ ...base, holdings: [common, classA] }, issuer], [])[1]!;
    expect(result.holdings.map((h) => [h.id, h.weight])).toEqual([
      ['cusip:422806109', '0.46'],
      ['cusip:422806208', '0.61'],
    ]);
  });
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
