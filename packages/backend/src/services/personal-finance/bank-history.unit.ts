import { describe, expect, it, jest } from '@jest/globals';
jest.mock('@models/index', () => ({ connection: { sequelize: {} } }));
jest.mock('@models/users-currencies.model', () => ({ getBaseCurrency: jest.fn() }));
import { mergeImportedBankHistory } from './bank-history';
const native = (date: string) => ({
  date,
  accountsBalance: 99900,
  portfoliosBalance: 10000,
  venturesBalance: 0,
  vehiclesBalance: 0,
  loansBalance: 0,
  totalBalance: 109900,
});
describe('historical balances in the automated bank dashboard', () => {
  it('replaces backfilled current values with actual sparse recorded dates before bank connection', () => {
    const result = mergeImportedBankHistory(
      [native('2024-06-01'), native('2024-06-15'), native('2026-11-05')],
      { mappings: [], liveFrom: '2026-11-04', points: [{ date: '2024-06-07', balance: 125.25, complete: true }] },
      '2024-06-01',
      '2026-11-05',
    );
    expect(result.map((p) => p.date)).toEqual(['2024-06-07', '2026-11-05']);
    expect(result[0]!.totalBalance).toBe(12525);
    expect(result[0]!.portfoliosBalance).toBe(0);
    expect(result[1]!.totalBalance).toBe(109900);
  });
  it('leaves unrecorded historical months empty and keeps live bank values primary', () => {
    const context = {
      mappings: [],
      liveFrom: '2026-11-04',
      points: [
        { date: '2024-05-01', balance: 500, complete: true },
        { date: '2026-11-05', balance: 1, complete: true },
      ],
    };
    expect(mergeImportedBankHistory([native('2024-06-01')], context, '2024-06-01', '2024-06-30')).toEqual([]);
    expect(mergeImportedBankHistory([native('2026-11-05')], context, '2026-11-05', '2026-11-05')[0]!.totalBalance).toBe(
      109900,
    );
  });
});
