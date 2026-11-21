import type { RecordId } from '@bt/shared/types';
import type { InvestmentAnalytics } from '@bt/shared/types/investment-analytics';

import { fillMissingCompanyClassifications } from '../classification-values';
import { compactAnalytics } from './compact-response';

describe('analytics transport and sourced classifications', () => {
  it('omits archived bytes and constituent lists without mutating source records', () => {
    const source = {
      fundSnapshots: [
        {
          holdings: [{ symbol: 'AAPL' }],
          provenance: { rawSourceGzipBase64: 'archive', sourceUrl: 'issuer' },
        },
      ],
    } as unknown as InvestmentAnalytics;
    const result = compactAnalytics(source);
    expect(result.fundSnapshots[0]!.holdings).toEqual([]);
    expect(result.fundSnapshots[0]!.holdingCount).toBe(1);
    expect(result.fundSnapshots[0]!.provenance!.rawSourceGzipBase64).toBeUndefined();
    expect(source.fundSnapshots[0]!.holdings).toHaveLength(1);
    expect(source.fundSnapshots[0]!.provenance!.rawSourceGzipBase64).toBe('archive');
  });
  it('fills missing industry without replacing issuer sector or inventing country', () => {
    const rows = [{ id: 'a', sector: 'Issuer sector', industry: 'Unknown' }];
    fillMissingCompanyClassifications(rows, [
      {
        id: 'a' as RecordId,
        companyClassifications: {
          source: 'Yahoo Finance',
          providerSymbol: 'AAPL',
          sourceUrl: 'https://finance.yahoo.com/quote/AAPL/profile/',
          observedAt: '2026-11-20T21:00:00Z',
          lastAttemptAt: '2026-11-20T21:00:00Z',
          sector: 'Technology',
          industry: 'Consumer Electronics',
        },
      },
    ]);
    expect(rows[0]!.sector).toBe('Issuer sector');
    expect(rows[0]!.industry).toBe('Yahoo Finance · Consumer Electronics');
    expect(rows[0]).not.toHaveProperty('country');
  });
});
