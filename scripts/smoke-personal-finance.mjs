import { mkdir, writeFile, unlink } from 'node:fs/promises';
// Synthetic-only isolated browser checks. All API traffic is intercepted, and
// this harness never visits the owner's signed-in application.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(resolve(repo, 'packages/frontend/package.json'));
const { chromium, expect } = require('@playwright/test');
const out = resolve(repo, 'private/qa');
const baseUrl = process.env.PERSONAL_FINANCE_QA_URL || 'http://localhost:8110';
const previewOrigin = new URL(baseUrl).origin;
if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname))
  throw new Error('QA preview must run on loopback.');
await mkdir(out, { recursive: true });
const harness = resolve(repo, 'packages/frontend/__qa-personal-finance.html');
await writeFile(
  harness,
  `<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic finance QA</title><style>html,body,#app{height:auto!important;overflow:visible!important;min-height:100%}</style></head><body><div id="app"></div><script type="module">
import '/src/styles/global.css';
import { createApp } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import { store } from '/src/stores/setup';
import { i18n } from '/src/i18n';
import { ROUTES_NAMES } from '/src/routes/constants';
import { setThemePreference } from '/src/common/utils/color-theme';
import Page from '/src/pages/personal-finance/index.vue';
const router = createRouter({ history: createMemoryHistory(), routes: Object.values(ROUTES_NAMES).map((name,i)=>({name,path:'/qa-'+i,component:{template:'<div />'}})) });
const app = createApp(Page); app.use(store); app.use(i18n); app.use(router); app.use(VueQueryPlugin, { queryClient: new QueryClient() }); app.mount('#app');
window.__qaTheme = setThemePreference;
</script></body></html>`,
);
const categories = [
  { id: 'spendable', name: 'Spendable Money', color: '#3b82f6' },
  { id: 'savings', name: 'Savings', color: '#10b981' },
  { id: 'investments', name: 'Investments', color: '#8b5cf6' },
  { id: 'retirement', name: 'Retirement', color: '#f59e0b' },
];
const accounts = categories.map((c, i) => ({
  id: `account-${i}`,
  name: `Synthetic ${c.name}`,
  currencyCode: 'USD',
  categoryId: c.id,
  included: true,
  balanceKind: 'asset',
  nativeAccountId: null,
  preferredSource: 'manual',
  latestBalance: [2500, 5000, 1200, 8000][i],
  valuationDate: '2026-11-01',
  principal: [2500, 4500, 1000, 7000][i],
  principalComplete: true,
  contributions: [2500, 4500, 1000, 7000][i],
  withdrawals: 0,
  interest: i === 1 ? 500 : 0,
  gain: [0, 500, 200, 1000][i],
  gainPercent: [0, 11.11, 20, 14.28][i],
  staleDays: 3,
  connectionStatus: 'manual',
  verified: true,
  valuationSource: 'manual',
}));
const dates = ['2026-09-17', '2026-10-12', '2026-11-01'];
const history = dates.map((date, j) => ({
  date,
  total: 14500 + j * 1100,
  knownTotal: 14500 + j * 1100,
  categories: { spendable: 2500, savings: 4500 + j * 250, investments: 1000 + j * 100, retirement: 6500 + j * 750 },
  missingAccountIds: [],
  complete: true,
  balances: Object.fromEntries(
    accounts.map((a, i) => [a.id, [2500, 4500 + j * 250, 1000 + j * 100, 6500 + j * 750][i]]),
  ),
}));
const snapshots = history.flatMap((p) =>
  accounts.map((a) => ({ accountId: a.id, date: p.date, balance: p.balances[a.id], currencyCode: 'USD' })),
);
const cashFlows = accounts.map((a) => ({
  id: `flow-${a.id}`,
  accountId: a.id,
  date: '2026-09-01',
  amount: a.principal,
  type: 'contribution',
  opening: true,
  toAccountId: null,
  description: 'Synthetic opening basis',
}));
const dashboard = {
  categories,
  accounts,
  history,
  snapshots,
  cashFlows,
  snapshotCount: snapshots.length,
  total: 16700,
  knownTotal: 16700,
  highest: 16700,
  monthlyChange: { amount: 1100, percent: 7.05 },
  yearlyChange: null,
  currencyCode: 'USD',
  asOf: '2026-11-01',
  complete: true,
};
const errors = [];
const calls = [];
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
  headless: true,
});
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, colorScheme: 'dark' });
  await context.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname.startsWith('/api/v1/')) {
      const path = url.pathname.slice('/api/v1'.length);
      let body;
      try {
        body = req.postDataJSON();
      } catch {}
      calls.push({ method: req.method(), path, body });
      let response;
      if (path === '/personal-finance/dashboard') response = dashboard;
      else if (path === '/accounts') response = [];
      else if (path === '/personal-finance/import/preview')
        response = {
          previewToken: 'synthetic-preview',
          records: body.records.map((r) => ({ ...r, action: 'insert' })),
          counts: { insert: body.records.length, duplicate: 0, protected: 0 },
          warnings: ['Synthetic import only'],
        };
      else if (path === '/personal-finance/import/commit') response = { imported: body.records.length };
      else if (path.startsWith('/personal-finance/')) response = { id: 'synthetic-saved' };
      else response = [];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', response }),
        headers: { 'access-control-allow-origin': previewOrigin, 'access-control-allow-credentials': 'true' },
      });
    }
    if (url.origin === previewOrigin) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${previewOrigin}/__qa-personal-finance.html`);
  await expect(page.getByRole('heading', { name: 'Personal net worth', exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('Synthetic Spendable Money', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  const datedPointPositions = await page
    .locator('svg[aria-label="Financial history chart"] circle')
    .evaluateAll((points) => points.map((point) => Number(point.getAttribute('cx'))));
  expect(datedPointPositions).toHaveLength(3);
  // Sep 17 -> Oct 12 spans 25 days; Oct 12 -> Nov 1 spans 20 days.
  expect(
    (datedPointPositions[1] - datedPointPositions[0]) / (datedPointPositions[2] - datedPointPositions[1]),
  ).toBeCloseTo(1.25, 2);
  for (const metric of [
    'total',
    'categories',
    'account',
    'monthly',
    'percent',
    'principal',
    'gains',
    'savings',
    'allocation',
  ]) {
    await page.locator('#finance-chart').selectOption(metric);
    await expect(page.locator('svg[aria-label="Financial history chart"]')).toBeVisible();
    const marks = await page
      .locator(
        'svg[aria-label="Financial history chart"] path, svg[aria-label="Financial history chart"] rect, svg[aria-label="Financial history chart"] circle',
      )
      .count();
    if (marks === 0) throw new Error(`No chart marks for ${metric}`);
  }
  await page.locator('#finance-chart').selectOption('categories');
  await page.screenshot({ path: resolve(out, 'desktop-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Record balance', exact: true }).click();
  await page.getByLabel('Balance', { exact: true }).fill('2575.25');
  await page.getByRole('button', { name: 'Save verified balance', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Verified valuation saved');
  const snapshotCall = calls.find((c) => c.path === '/personal-finance/snapshots' && c.method === 'POST');
  expect(snapshotCall.body).toMatchObject({
    accountId: 'account-0',
    balance: 2575.25,
    source: 'manual',
    verified: true,
  });
  await page.getByRole('button', { name: 'Record cash flow', exact: true }).click();
  await page.getByLabel(/^Type/).selectOption('transfer');
  await page.getByLabel('Amount', { exact: true }).fill('100');
  await page.getByLabel(/^Destination account/).selectOption('account-1');
  await page.getByRole('button', { name: 'Save cash flow', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Cash flow recorded');
  const flowCall = calls.find((c) => c.path === '/personal-finance/cash-flows' && c.method === 'POST');
  expect(flowCall.body).toMatchObject({
    accountId: 'account-0',
    toAccountId: 'account-1',
    type: 'transfer',
    amount: 100,
    opening: false,
  });
  await page.getByRole('button', { name: 'Import history', exact: true }).click();
  await page.getByLabel('Choose historical balance file').setInputFiles({
    name: 'synthetic-history.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('account,date,balance,currencyCode\nLegacy synthetic account,2022-06-15,100,USD\n'),
  });
  await page.getByLabel('Legacy synthetic account').selectOption('account-0');
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(page.getByText('Preview ready', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '2022-06-15', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 records', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('History imported');
  const importCall = calls.find((c) => c.path === '/personal-finance/import/commit' && c.method === 'POST');
  expect(importCall.body).toMatchObject({
    source: 'csv',
    previewToken: 'synthetic-preview',
    records: [{ accountId: 'account-0', date: '2022-06-15', balance: 100 }],
  });
  await page.getByRole('button', { name: 'Categories', exact: true }).click();
  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  expect(
    await page.locator('input').evaluateAll((inputs) => inputs.some((input) => input.value === 'New category')),
  ).toBe(true);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#finance-chart').selectOption('total');
  await expect(page.locator('svg[aria-label="Financial history chart"]')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: resolve(out, 'mobile-dark.png'), fullPage: true });
  await page.evaluate(() => window.__qaTheme('light'));
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.screenshot({ path: resolve(out, 'desktop-light.png'), fullPage: true });
  expect(errors).toEqual([]);
  await writeFile(
    resolve(out, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        charts: 9,
        snapshot: true,
        transfer: true,
        previewAndCommit: true,
        categoryAdd: true,
        mobileOverflow: false,
        browserErrors: errors,
        apiCalls: calls.length,
      },
      null,
      2,
    ),
  );
  console.log(
    'Synthetic browser QA passed: 9 charts, snapshot/transfer/import/category forms, desktop/mobile, dark/light.',
  );
} finally {
  await browser.close();
  await unlink(harness);
}
