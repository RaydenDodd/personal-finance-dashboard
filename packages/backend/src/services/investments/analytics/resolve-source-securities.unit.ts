jest.mock('../data-providers', () => ({ dataProviderFactory: { getProvider: () => ({ searchSecurities: search }) } }));
jest.mock('../securities/add-from-search.service', () => ({
  addSecurityFromSearch: jest.fn(async ({ searchResult }) => ({
    security: { ...searchResult, id: 'native-security' },
  })),
}));
import type { BrokerData } from '../broker-records/schema';
import { resolveSourceSecurities } from './resolve-source-securities';
const search = jest.fn();
const base: Omit<BrokerData, 'sourceEvents'> = {
  broker: 'robinhood',
  accountKey: 'fixture',
  snapshots: [],
  documents: [],
  taxReports: [],
  review: [],
  historyComplete: false,
};
describe('past-security market-data identity recovery', () => {
  it('uses the native registry only after exact ticker, currency, asset and broker company match', async () => {
    search.mockResolvedValue([{ symbol: 'NIO', name: 'NIO Inc.', currencyCode: 'USD', assetClass: 'stocks' }]);
    const r = await resolveSourceSecurities(
      [
        {
          data: {
            ...base,
            sourceEvents: [{ action: 'Buy', symbol: 'NIO', description: 'NIO\nCUSIP: 62914V106' }],
          } as BrokerData,
        },
      ],
      [],
    );
    expect(r.added[0]?.id).toBe('native-security');
    expect(r.unresolved).toHaveLength(0);
  });
  it('rejects ticker reuse and leaves delisted identity unresolved rather than substituting a new company', async () => {
    search.mockResolvedValue([
      { symbol: 'AT', name: 'ATI Physical Therapy', currencyCode: 'USD', assetClass: 'stocks' },
    ]);
    const r = await resolveSourceSecurities(
      [
        {
          data: {
            ...base,
            sourceEvents: [{ action: 'Buy', symbol: 'AT', description: 'Atlantic Power\nCUSIP: 04878Q863' }],
          } as BrokerData,
        },
      ],
      [],
    );
    expect(r.added).toHaveLength(0);
    expect(r.unresolved[0]?.symbol).toBe('AT');
  });
});
