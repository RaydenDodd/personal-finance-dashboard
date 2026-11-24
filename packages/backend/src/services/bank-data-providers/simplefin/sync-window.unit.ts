import { simplefinSyncStart } from './sync-window';
const to = new Date('2026-11-24T12:00:00Z');
describe('SimpleFIN incremental overlap', () => {
  it('covers late-posting rows even after newer transactions were imported', () => {
    expect(
      simplefinSyncStart({
        to,
        anchor: new Date('2026-11-24T10:00:00Z'),
        fetchedAt: new Date('2026-11-23T12:00:00Z'),
      }).toISOString(),
    ).toBe('2026-11-18T12:00:00.000Z');
  });
  it('advances empty accounts using the fetched checkpoint, avoiding repeated full backfills', () => {
    expect(simplefinSyncStart({ to, anchor: null, fetchedAt: new Date('2026-11-24T10:00:00Z') }).toISOString()).toBe(
      '2026-11-19T10:00:00.000Z',
    );
  });
  it('backfills at most 90 days on the first fetch', () => {
    expect(to.getTime() - simplefinSyncStart({ to, anchor: null }).getTime()).toBe(90 * 86400000);
  });
  it('ignores a future cursor and respects forward-only linking', () => {
    expect(
      simplefinSyncStart({
        to,
        anchor: null,
        fetchedAt: new Date('2027-01-01Z'),
        linkedAt: new Date('2026-11-22Z'),
      }).toISOString(),
    ).toBe('2026-11-22T00:00:00.000Z');
  });
});
