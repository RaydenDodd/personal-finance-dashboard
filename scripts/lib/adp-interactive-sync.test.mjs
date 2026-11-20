import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { runInteractiveAdpSync } from './adp-interactive-sync.mjs';

function fakeBrowser({ closeEarly = false, failExport = false } = {}) {
  const page = new EventEmitter(),
    calls = [];
  Object.assign(page, {
    goto: async (url) => {
      calls.push(url);
      queueMicrotask(() =>
        closeEarly
          ? page.emit('close')
          : context.emit('response', {
              url: () => 'https://my.adp.com/myadp_prefix/payroll/v1/workers/synthetic-worker/pay-statements',
              status: () => 200,
              headers: () => ({ 'content-type': 'application/json' }),
              frame: () => ({ page: () => page }),
            }),
      );
    },
    evaluate: async (fn, options) => {
      calls.push(options);
      if (failExport) throw Error('ADP returned HTTP 403');
      return { payStatements: [{ statementId: 'synthetic' }] };
    },
    off: page.off,
    url: () => 'https://my.adp.com/',
  });
  const context = Object.assign(new EventEmitter(), {
    newPage: async () => page,
    close: async () => {
      calls.push('context.close');
      page.emit('close');
    },
  });
  const browser = {
    newContext: async (options) => {
      calls.push(options);
      return context;
    },
    close: async () => calls.push('browser.close'),
  };
  return {
    chromium: {
      launch: async (options) => {
        calls.push(options);
        return browser;
      },
    },
    calls,
  };
}
test('login is owner-operated, automatic reads follow the real history response and close the context', async () => {
  const f = fakeBrowser(),
    phases = [];
  const result = await runInteractiveAdpSync({ chromium: f.chromium, status: (s) => phases.push(s) });
  assert.equal(result.payStatements.length, 1);
  assert.deepEqual(phases, ['sign-in', 'collecting']);
  assert.ok(f.calls.some((v) => v?.workerId === 'synthetic-worker'));
  assert.deepEqual(f.calls.slice(-2), ['context.close', 'browser.close']);
  assert.equal(f.calls[0].headless, false);
  assert.equal(f.calls[1].serviceWorkers, 'block');
});
test('closing the login window or an ADP denial cannot return a successful export', async () => {
  for (const options of [{ closeEarly: true }, { failExport: true }]) {
    const f = fakeBrowser(options);
    await assert.rejects(runInteractiveAdpSync({ chromium: f.chromium }));
    assert.deepEqual(f.calls.slice(-2), ['context.close', 'browser.close']);
  }
});
test('cancellation before login closes the temporary context without requesting ADP', async () => {
  const f = fakeBrowser(),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(runInteractiveAdpSync({ chromium: f.chromium, signal: controller.signal }), /Cancelled/);
  assert.ok(!f.calls.some((v) => typeof v === 'string' && v.startsWith('https://')));
});
