jest.mock('@models/investments/fund-holdings-snapshot.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOrCreate: jest.fn() },
}));
jest.mock('@models/connection', () => ({ connection: { sequelize: { query: jest.fn().mockResolvedValue([]) } } }));
jest.mock('@services/common/with-transaction', () => ({ withTransaction: (fn: unknown) => fn }));

import InvestmentFundSnapshots from '@models/investments/fund-holdings-snapshot.model';

import { fundSnapshotSchema, latestFundSnapshots, saveFundSnapshots } from './fund-snapshots';

const input = {
  fundId: 'fund',
  symbol: 'FUND',
  asOf: '2025-01-01',
  provider: 'Official issuer manual download',
  holdings: [{ id: 'US:1', symbol: 'ONE', name: 'One', weight: '40' }],
};
describe('dated composition validation and provenance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('accepts partial coverage as partial instead of normalizing', () => {
    expect(fundSnapshotSchema.parse(input).holdings[0]?.weight).toBe('40');
  });
  it('rejects duplicate identities, excess weights, negative and future weights/dates', () => {
    expect(fundSnapshotSchema.safeParse({ ...input, holdings: [...input.holdings, ...input.holdings] }).success).toBe(
      false,
    );
    expect(
      fundSnapshotSchema.safeParse({ ...input, holdings: [{ ...input.holdings[0], weight: '101' }] }).success,
    ).toBe(false);
    expect(fundSnapshotSchema.safeParse({ ...input, holdings: [{ ...input.holdings[0], weight: '-1' }] }).success).toBe(
      false,
    );
    expect(fundSnapshotSchema.safeParse({ ...input, asOf: '2099-01-01' }).success).toBe(false);
  });
  it('selects historical composition without applying future snapshots retroactively', () => {
    const snapshots = [
      { ...input, retrievedAt: '2025-01-02T00:00:00Z', coverage: '40' },
      { ...input, asOf: '2026-01-01', retrievedAt: '2026-01-02T00:00:00Z', coverage: '40' },
    ];
    expect(latestFundSnapshots(snapshots, '2025-06-01')[0]?.asOf).toBe('2025-01-01');
    expect(latestFundSnapshots(snapshots, '2024-01-01')).toHaveLength(0);
  });
  it('prefers an explicitly versioned reparse of the same file in either retrieval order', () => {
    const provenance = { sourceId: 'ishares-csv', sha256: '1'.repeat(64), parserVersion: '1.0.0' } as NonNullable<
      Parameters<typeof latestFundSnapshots>[0][number]['provenance']
    >;
    const old = { ...input, coverage: '40', retrievedAt: '2025-01-02T00:00:00Z', provenance };
    const revised = { ...old, coverage: '39', provenance: { ...provenance, parserVersion: '1.0.1' } };
    for (const snapshots of [
      [old, revised],
      [revised, old],
    ])
      expect(latestFundSnapshots(snapshots, '2025-06-01')[0]).toBe(revised);
  });
  it('keeps identical repeat imports idempotent despite JSONB property ordering and retrieval timestamps', async () => {
    const data = {
      coverage: '40',
      holdings: input.holdings,
      provider: input.provider,
      symbol: input.symbol,
      fundId: input.fundId,
      asOf: input.asOf,
      retrievedAt: '2025-01-02T00:00:00Z',
    };
    jest.mocked(InvestmentFundSnapshots.findOne).mockResolvedValue({ data } as InvestmentFundSnapshots);
    expect(await saveFundSnapshots({ userId: 1, snapshots: [input] })).toEqual({ inserted: 0, duplicates: 1 });
    expect(InvestmentFundSnapshots.findOrCreate).not.toHaveBeenCalled();
  });
  it('rejects revisions of an existing source/date composition without changing it', async () => {
    jest.mocked(InvestmentFundSnapshots.findOne).mockResolvedValue({
      data: { ...input, retrievedAt: '2025-01-02T00:00:00Z', coverage: '40' },
    } as InvestmentFundSnapshots);
    await expect(
      saveFundSnapshots({ userId: 1, snapshots: [{ ...input, holdings: [{ ...input.holdings[0]!, weight: '50' }] }] }),
    ).rejects.toThrow('immutable');
    expect(InvestmentFundSnapshots.findOrCreate).not.toHaveBeenCalled();
  });
  it('replays source imports idempotently after JSONB removes undefined optional fields', async () => {
    const replay = { ...input, holdings: [{ ...input.holdings[0]!, country: undefined, isin: undefined }] };
    const data = JSON.parse(JSON.stringify({ ...replay, coverage: '40', retrievedAt: '2025-01-02T00:00:00Z' }));
    jest.mocked(InvestmentFundSnapshots.findOne).mockResolvedValue({ data } as InvestmentFundSnapshots);
    expect(await saveFundSnapshots({ userId: 1, snapshots: [replay] })).toEqual({ inserted: 0, duplicates: 1 });
  });
});
