import { nextBankSyncAt } from './schedule';

describe('next bank sync in UTC', () => {
  it('chooses the next configured slot independently of local DST', () => {
    expect(nextBankSyncAt([0, 6, 12, 18], new Date('2026-11-01T05:59:59Z'))).toBe(Date.parse('2026-11-01T06:00:00Z'));
    expect(nextBankSyncAt([0, 6, 12, 18], new Date('2026-03-08T06:00:00Z'))).toBe(Date.parse('2026-03-08T12:00:00Z'));
  });
  it('rolls the final slot to the next day and handles duplicate hours once', () => {
    expect(nextBankSyncAt([6, 6], new Date('2026-12-31T18:00:00Z'))).toBe(Date.parse('2027-01-01T06:00:00Z'));
  });
  it('does not advertise an invalid or absent schedule', () => {
    expect(nextBankSyncAt([-1, 24, NaN, 1.5])).toBeNull();
    expect(nextBankSyncAt([])).toBeNull();
  });
});
