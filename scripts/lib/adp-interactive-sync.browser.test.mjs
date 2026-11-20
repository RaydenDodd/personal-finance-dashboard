import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';

import { runInteractiveAdpSync } from './adp-interactive-sync.mjs';

// Real Edge, synthetic website only. No live ADP request, credentials, or payroll data.
for (const mode of ['history', 'detail', 'cached'])
  test(
    `Edge completes ${mode} Pay navigation, same-origin reads and temporary-session cleanup`,
    { timeout: 30000 },
    async () => {
      let browser,
        context,
        page,
        reads = 0;
      const history = '/myadp_prefix/payroll/v1/workers/test-worker/pay-statements';
      const launcher = {
        launch: async (options) => {
          browser = await chromium.launch({ ...options, headless: true, channel: 'msedge' });
          const newContext = browser.newContext.bind(browser);
          browser.newContext = async (options) => {
            context = await newContext(options);
            await context.route('**/*', async (route) => {
              const url = new URL(route.request().url());
              assert.equal(url.origin, 'https://my.adp.com');
              if (url.pathname === '/')
                return route.fulfill({
                  contentType: 'text/html',
                  body: `<button>Synthetic sign-in complete</button><script>document.querySelector('button').onclick=()=>{const a=document.createElement('a');a.href='/pay';a.textContent='Pay';document.body.replaceChildren(a)}</script>`,
                });
              if (url.pathname === '/pay')
                return route.fulfill({
                  contentType: 'text/html',
                  body: `<h1>Pay statements</h1><script>fetch('${history}${mode === 'detail' ? '/test-statement' : '?adjustments=yes&numberoflastpaydates=160'}')</script>`,
                });
              reads++;
              if (mode === 'cached' && reads === 1)
                return route.fulfill({
                  contentType: 'text/plain',
                  body: JSON.stringify({
                    payStatements: [{ statementId: 'test-statement', payAdjustmentIndicator: false }],
                  }),
                });
              if (url.pathname === history)
                return route.fulfill({
                  json: { payStatements: [{ statementId: 'test-statement', payAdjustmentIndicator: false }] },
                });
              if (url.pathname === history + '/test-statement')
                return route.fulfill({
                  json: {
                    payDate: '2026-11-13',
                    grossPayAmount: { amountValue: 100, currencyCode: 'USD' },
                    netPayAmount: { amountValue: 80, currencyCode: 'USD' },
                  },
                });
              throw Error('Unexpected request');
            });
            context.on('page', (value) => {
              page = value;
              void value.getByRole('button', { name: 'Synthetic sign-in complete' }).click();
            });
            return context;
          };
          return browser;
        },
      };
      try {
        const phases = [],
          progress = [];
        const result = await runInteractiveAdpSync({
          chromium: launcher,
          status: (phase, counts) => {
            phases.push(phase);
            if (counts) progress.push(counts);
          },
          loginTimeoutMs: 10000,
          collectionOptions: { pauseMs: 0 },
        });
        assert.equal(phases[0], 'sign-in');
        assert.ok(phases.slice(1).every((phase) => phase === 'collecting'));
        assert.deepEqual(progress, [
          { completed: 0, total: 1 },
          { completed: 1, total: 1 },
        ]);
        assert.equal(reads, 3);
        assert.deepEqual(result.payStatements, [
          {
            payDate: '2026-11-13',
            grossPayAmount: { amountValue: 100, currencyCode: 'USD' },
            netPayAmount: { amountValue: 80, currencyCode: 'USD' },
            statementId: 'test-statement',
            payAdjustmentIndicator: false,
          },
        ]);
        assert.ok(page.isClosed());
        assert.equal(browser.isConnected(), false);
      } finally {
        await browser?.close();
      }
    },
  );
