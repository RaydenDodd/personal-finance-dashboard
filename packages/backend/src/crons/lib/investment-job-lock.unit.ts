import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const query = jest.fn<() => Promise<{ acquired: boolean }[]>>();
const transaction = {};
const execute = jest.fn(async (fn: (tx: object) => Promise<unknown>) => fn(transaction));

jest.mock('@models/connection', () => ({
  connection: { sequelize: { query: (...args: []) => query(...args), transaction: (fn: (tx: object) => Promise<unknown>) => execute(fn) } },
  runOutsideTransaction: (fn: () => Promise<unknown>) => fn(),
}));
jest.mock('@js/utils/logger', () => ({ logger: { info: jest.fn() } }));

import { withInvestmentJobLock } from './investment-job-lock';

beforeEach(() => {
  query.mockReset();
  execute.mockClear();
});

describe('investment job advisory lock', () => {
  it('executes work only after acquiring the lock and returns its result', async () => {
    query.mockResolvedValue([{ acquired: true }]);
    const work = jest.fn(async (n: number) => n + 1);
    await expect(withInvestmentJobLock('read-model', work)(4)).resolves.toBe(5);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledWith(4);
  });

  it('does not run financial work when another session owns the lock', async () => {
    query.mockResolvedValue([{ acquired: false }]);
    const work = jest.fn(async () => true);
    await expect(withInvestmentJobLock('read-model', work)()).rejects.toThrow('already running');
    expect(work).not.toHaveBeenCalled();
  });

  it('propagates work failures so the managed transaction can roll back', async () => {
    query.mockResolvedValue([{ acquired: true }]);
    const work = jest.fn(async () => { throw new Error('failed'); });
    await expect(withInvestmentJobLock('daily-history', work)()).rejects.toThrow('failed');
  });
});
