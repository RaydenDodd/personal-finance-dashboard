import assert from 'node:assert/strict';
import test from 'node:test';

import { collectAdpPayroll, withTemporaryAdpBrowser } from './adp-payroll-export.mjs';

const workerId = 'synthetic-worker';
const history = {
  payStatements: [
    { payDate: '2026-01-02', payDetailUri: { href: `/payroll/v1/workers/${workerId}/pay-statements/stmt-1` } },
    {
      payDate: '2026-01-02',
      payAdjustmentIndicator: true,
      payDetailUri: { href: `/payroll/v1/workers/${workerId}/pay-statements/stmt-2` },
    },
  ],
};
const detail = (id) => ({
  statementId: id,
  payDate: '2026-01-02',
  payAdjustmentIndicator: id === 'stmt-2',
  grossPayAmount: { amountValue: id === 'stmt-1' ? 2000 : -10, currencyCode: 'USD' },
  netPayAmount: { amountValue: id === 'stmt-1' ? 1400 : -7, currencyCode: 'USD' },
  earnings: [{ earningCodeName: 'Regular', earningAmount: { amountValue: 2000, currencyCode: 'USD' } }],
});
const response = (json, status = 200, contentType = 'application/json') => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => contentType },
  json: async () => json,
});

test('real ADP history URI identities produce the verified payStatements wrapper and retain adjustments', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? response(history) : response(detail(`stmt-${calls.length - 1}`));
  });
  const result = await collectAdpPayroll({ workerId, pauseMs: 0 });
  assert.equal(result.expectedStatements, 2);
  assert.equal(result.downloadedStatements, 2);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(
    result.payStatements.map((s) => s.statementId),
    ['stmt-1', 'stmt-2'],
  );
  assert.equal(result.payStatements[1].grossPayAmount.amountValue, -10);
  assert.equal(result.payStatements[1].payAdjustmentIndicator, true);
  assert.equal(calls.length, 3);
  assert.ok(calls[0].url.endsWith('?adjustments=yes&numberoflastpaydates=160'));
  assert.ok(calls.every((c) => c.options.credentials === 'same-origin' && c.options.redirect === 'error'));
  assert.equal(result.history, undefined);
  assert.equal(result.cookies, undefined);
});

for (const status of [401, 403, 429]) {
  test(`HTTP ${status} stops immediately with no retry or partial successful export`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => (++calls === 1 ? response(history) : response({}, status)));
    await assert.rejects(collectAdpPayroll({ workerId, pauseMs: 0 }), new RegExp(`HTTP ${status}`));
    assert.equal(calls, 2);
  });
}

test('login HTML, identity conflicts, cross-employee and external links fail without requesting details', async (t) => {
  const examples = [
    response({}, 200, 'text/html'),
    response({ payStatements: [{ statementId: 'other', payDetailUri: history.payStatements[0].payDetailUri }] }),
    response({ payStatements: [{ payDetailUri: { href: '/payroll/v1/workers/someone-else/pay-statements/stmt-1' } }] }),
    response({
      payStatements: [
        { payDetailUri: { href: 'https://example.com/payroll/v1/workers/synthetic-worker/pay-statements/stmt-1' } },
      ],
    }),
    response({ payStatements: [history.payStatements[0], history.payStatements[0]] }),
  ];
  for (const item of examples) {
    let calls = 0;
    const mocked = t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return item;
    });
    await assert.rejects(collectAdpPayroll({ workerId, pauseMs: 0 }));
    assert.equal(calls, 1);
    mocked.mock.restore();
  }
});

test('detail wrapper and URL-bound omitted identity preserve payroll fields', async (t) => {
  const row = detail('stmt-1');
  delete row.statementId;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () =>
    ++calls === 1 ? response({ payStatements: [history.payStatements[0]] }) : response({ payStatements: [row] }),
  );
  const result = await collectAdpPayroll({ workerId, pauseMs: 0 });
  assert.equal(result.payStatements[0].statementId, 'stmt-1');
  assert.deepEqual(result.payStatements[0].grossPayAmount, row.grossPayAmount);
});

test('history preserves both adjustment flags when live detail omits them', async (t) => {
  const rows = history.payStatements.map((row, i) => ({ ...row, payAdjustmentIndicator: i === 1 }));
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++calls === 1) return response({ payStatements: rows });
    const row = detail(`stmt-${calls - 1}`);
    delete row.payAdjustmentIndicator;
    return response(row);
  });
  const result = await collectAdpPayroll({ workerId, pauseMs: 0 });
  assert.deepEqual(
    result.payStatements.map((row) => row.payAdjustmentIndicator),
    [false, true],
  );
  assert.equal(result.payStatements[1].grossPayAmount.amountValue, -10);
});

test('missing, invalid or conflicting adjustment status cannot silently change a paycheck', async (t) => {
  for (const [historyFlag, detailFlag] of [
    [true, false],
    [undefined, undefined],
    ['yes', undefined],
  ]) {
    let calls = 0;
    const row = { ...history.payStatements[0], payAdjustmentIndicator: historyFlag };
    const value = { ...detail('stmt-1'), payAdjustmentIndicator: detailFlag };
    const mocked = t.mock.method(globalThis, 'fetch', async () =>
      ++calls === 1 ? response({ payStatements: [row] }) : response(value),
    );
    await assert.rejects(collectAdpPayroll({ workerId, pauseMs: 0 }), /adjustment status/);
    assert.equal(calls, 2);
    mocked.mock.restore();
  }
});

test('detail identity mismatch and interrupted fetch cannot emit a successful export', async (t) => {
  let calls = 0;
  const mocked = t.mock.method(globalThis, 'fetch', async () =>
    ++calls === 1 ? response({ payStatements: [history.payStatements[0]] }) : response(detail('someone-else')),
  );
  await assert.rejects(collectAdpPayroll({ workerId, pauseMs: 0 }), /identity conflict/);
  mocked.mock.restore();
  t.mock.method(
    globalThis,
    'fetch',
    async (_url, options) =>
      new Promise((_resolve, reject) =>
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
      ),
  );
  await assert.rejects(collectAdpPayroll({ workerId, pauseMs: 0, timeoutMs: 2 }), /aborted/);
});

for (const failure of [false, true]) {
  test(`isolated nonpersistent browser is cleaned on ${failure ? 'failure' : 'success'}`, async () => {
    const calls = [];
    const context = { close: async () => calls.push('context.close') };
    const browser = {
      newContext: async (options) => {
        calls.push(options);
        return context;
      },
      close: async () => calls.push('browser.close'),
    };
    const chromium = {
      launch: async (options) => {
        calls.push(options);
        return browser;
      },
    };
    const action = () =>
      withTemporaryAdpBrowser(chromium, 'msedge', async (c) => {
        assert.equal(c, context);
        if (failure) throw new Error('synthetic failure');
        return 42;
      });
    if (failure) await assert.rejects(action(), /synthetic failure/);
    else assert.equal(await action(), 42);
    assert.deepEqual(calls, [
      { headless: false, channel: 'msedge' },
      { acceptDownloads: false, serviceWorkers: 'block' },
      'context.close',
      'browser.close',
    ]);
  });
}

test('browser still closes if creating a context fails', async () => {
  let closed = false;
  await assert.rejects(
    withTemporaryAdpBrowser(
      {
        launch: async () => ({
          newContext: async () => {
            throw new Error('synthetic context failure');
          },
          close: async () => {
            closed = true;
          },
        }),
      },
      'chromium',
      async () => {},
    ),
    /context failure/,
  );
  assert.equal(closed, true);
});
