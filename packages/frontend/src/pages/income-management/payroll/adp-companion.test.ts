import type { PayrollDashboard } from '@bt/shared/types/payroll';
import { describe, expect, it, vi } from 'vitest';

import { startAdpCompanion } from './adp-companion';
import { planAdpImport } from './adp-import-plan';

describe('user initiated ADP bridge', () => {
  function bridge() {
    let message: (value: Record<string, unknown>) => void = () => {},
      disconnect: () => void = () => {},
      nonce = '';
    const port = {
      onMessage: {
        addListener: (listener: typeof message) => {
          message = listener;
        },
      },
      onDisconnect: {
        addListener: (listener: typeof disconnect) => {
          disconnect = listener;
        },
      },
      postMessage: (v: Record<string, string>) => {
        nonce = v.nonce ?? '';
      },
      disconnect: vi.fn(),
    };
    vi.stubGlobal('chrome', { runtime: { connect: () => port } });
    const status = vi.fn();
    const job = startAdpCompanion(status);
    return {
      job,
      status,
      port,
      send: (v: Record<string, unknown>) => message({ ...v, nonce }),
      foreign: (v: Record<string, unknown>) => message(v),
      drop: () => disconnect(),
    };
  }
  it('assembles a complete in-memory export and disconnects without storing session data', async () => {
    const b = bridge(),
      json = JSON.stringify({
        expectedStatements: 1,
        downloadedStatements: 1,
        failures: [],
        payStatements: [{ statementId: 'sample', payDate: '2026-01-01' }],
      }),
      bytes = new TextEncoder().encode(json);
    b.send({ type: 'begin', parts: 1, bytes: bytes.length, count: 1 });
    b.send({ type: 'chunk', index: 0, data: btoa(json) });
    b.send({ type: 'complete' });
    expect(await b.job.result).toEqual([{ statementId: 'sample', payDate: '2026-01-01' }]);
    expect(b.port.disconnect).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
  it('reports bounded download counts without accepting partial payroll as a finished import', async () => {
    const b = bridge();
    b.send({ type: 'status', phase: 'collecting', completed: 4, total: 72 });
    expect(b.status).toHaveBeenCalledWith('collecting', { completed: 4, total: 72 });
    b.send({ type: 'status', phase: 'collecting', completed: 9999, total: 72 });
    expect(b.status).toHaveBeenLastCalledWith('collecting', undefined);
    const rejected = expect(b.job.result).rejects.toThrow();
    b.job.cancel();
    await rejected;
    vi.unstubAllGlobals();
  });
  it('rejects interrupted, wrong-session and out-of-order exports rather than importing partial data', async () => {
    for (const failure of ['disconnect', 'nonce', 'chunk', 'cancel']) {
      const b = bridge(),
        rejected = expect(b.job.result).rejects.toThrow();
      if (failure === 'disconnect') b.drop();
      if (failure === 'nonce') b.foreign({ type: 'complete', nonce: 'wrong' });
      if (failure === 'chunk') b.send({ type: 'chunk', index: 1, data: 'e30=' });
      if (failure === 'cancel') b.job.cancel();
      await rejected;
    }
    vi.unstubAllGlobals();
  });
  it('keeps existing employer mappings and requires a real target for newly observed identities', () => {
    const data = {
      employments: [{ id: 'old' }, { id: 'current' }],
      statements: [
        { source: 'adp', statementId: 'old-one', employmentId: 'old' },
        { source: 'adp', statementId: 'current-one', employmentId: 'current' },
      ],
    } as PayrollDashboard;
    const rows = [{ statementId: 'old-one' }, { statementId: 'current-one' }, { statementId: 'new-one' }];
    const plan = planAdpImport(data, rows, 'current');
    expect(
      plan.map((g) => [
        g.employmentId,
        JSON.parse(g.content).payStatements.map((r: { statementId: string }) => r.statementId),
      ]),
    ).toEqual([
      ['old', ['old-one']],
      ['current', ['current-one', 'new-one']],
    ]);
    expect(() => planAdpImport(data, rows, 'foreign')).toThrow();
    expect(() => planAdpImport(data, [rows[0]!, rows[0]!], 'current')).toThrow();
  });
});
