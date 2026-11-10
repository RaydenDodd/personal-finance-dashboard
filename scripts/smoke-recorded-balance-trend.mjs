import { chromium, webkit, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, unlink } from 'node:fs/promises';

// Fictional observations only. No Pi, owner credentials, bank connection or live data.
const base = process.env.PERSONAL_FINANCE_QA_URL ?? 'http://127.0.0.1:8110';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const harness = 'packages/frontend/__qa-recorded-trend.html';
const output = 'private/qa-recorded-trend';
await mkdir(output, { recursive: true });
const observations = [
  ['2022-06-15', 1000],
  ['2023-02-16', 2500],
  ['2023-06-05', 4000],
  ['2026-08-01', 10000],
  ['2026-09-01', 11000],
  ['2026-10-01', 12500],
].map(([date, totalBalance]) => ({
  date,
  totalBalance,
  accountsBalance: totalBalance,
  portfoliosBalance: 0,
  venturesBalance: 0,
  vehiclesBalance: 0,
  loansBalance: 0,
  historySource: 'imported',
  liabilitiesAvailable: false,
}));
await writeFile(
  harness,
  `<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><script>window.__APP_CONFIG__={IS_SELF_HOST:'true',API_HTTP:location.origin,API_VER:'/api/v1'};</script></head><body><div id="app"></div><script type="module">
import '/src/styles/global.css';import '/src/app.vue';
import {createApp,h,ref} from 'vue';import {createHead} from '@unhead/vue/client';import {createRouter,createMemoryHistory} from 'vue-router';import {VueQueryPlugin,QueryClient} from '@tanstack/vue-query';import {parseISO} from 'date-fns';
import {store} from '/src/stores/setup';import {useCurrenciesStore} from '/src/stores/currencies';import {i18n,loadChunks} from '/src/i18n';import {ROUTES_NAMES} from '/src/routes/constants';
import Widget from '/src/components/widgets/balance-trend.vue';
const period=ref({from:parseISO('2026-09-01'),to:parseISO('2026-09-30')});window.__qaPeriod=(from,to)=>period.value={from:parseISO(from),to:parseISO(to)};
await loadChunks({locale:'en',chunks:['pages/dashboard','dialogs','forms','errors']});
const app=createApp({render:()=>h('main',{class:'p-4'},h('div',{style:'height:540px;max-width:900px'},h(Widget,{selectedPeriod:period.value})))});
app.use(store);app.use(i18n);app.use(createHead());app.use(createRouter({history:createMemoryHistory(),routes:Object.values(ROUTES_NAMES).map((name,i)=>({name,path:'/qa-'+i,component:{template:'<div/>'}}))}));app.use(VueQueryPlugin,{queryClient:new QueryClient({defaultOptions:{queries:{retry:false}}})});app.provide('dashboard-widget-stretch',true);
useCurrenciesStore().baseCurrency={id:1,currencyCode:'USD',code:'USD',symbol:'$',currency:{code:'USD',symbol:'$'}};app.mount('#app');
</script></body></html>`,
);
let browser;
const results = [];
try {
  for (const engine of ['webkit', 'chromium']) {
    browser = await (engine === 'webkit'
      ? webkit.launch({ headless: true })
      : chromium.launch({ channel: 'msedge', headless: true }));
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      timezoneId: 'America/New_York',
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    const errors = [],
      writes = [];
    await context.route('**/api/v1/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (request.method() !== 'GET') writes.push(request.method());
      const response = url.pathname.endsWith('/stats/combined-balance-history')
        ? observations.filter(
            (p) => p.date >= (url.searchParams.get('from') ?? '') && p.date <= (url.searchParams.get('to') ?? '9999'),
          )
        : [];
      await route.fulfill({ json: { status: 'success', response } });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + '/__qa-recorded-trend.html');
    const widget = page.getByTestId('widget-balance-trend');
    for (const [from, to] of [
      ['2026-09-01', '2026-09-30'],
      ['2026-10-01', '2026-10-31'],
      ['2023-06-01', '2023-06-30'],
      ['2022-06-01', '2022-06-30'],
    ]) {
      await page.evaluate(([from, to]) => window.__qaPeriod(from, to), [from, to]);
      const current = observations.filter((p) => p.date >= from && p.date <= to).at(-1);
      const previous = observations.filter((p) => p.date < from).at(-1);
      const expected = previous ? [previous, current] : [current];
      await expect
        .poll(() => widget.locator('.recorded-observation').evaluateAll((nodes) => nodes.map((n) => n.__data__.value)))
        .toEqual(expected.map((p) => p.totalBalance));
      const dates = await widget.locator('.recorded-observation').evaluateAll((nodes) =>
        nodes.map((n) => {
          const d = new Date(n.__data__.date);
          return [
            d.getFullYear(),
            String(d.getMonth() + 1).padStart(2, '0'),
            String(d.getDate()).padStart(2, '0'),
          ].join('-');
        }),
      );
      assert.deepEqual(
        dates,
        expected.map((p) => p.date),
      );
      const line = await widget.locator('path.line').getAttribute('d');
      assert.ok(line && !/NaN|Infinity/.test(line));
      if (previous) assert.ok(line.includes('L'));
      await expect(
        widget
          .getByText(
            new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(current.totalBalance),
            { exact: true },
          )
          .first(),
      ).toBeVisible();
      await expect
        .poll(() =>
          widget
            .locator('.recorded-observation')
            .first()
            .evaluate((node) => {
              const bounds = node.getBoundingClientRect();
              const frame = node.closest('svg').parentElement;
              return bounds.width > 1 && bounds.height > 1 && getComputedStyle(frame).opacity === '1';
            }),
        )
        .toBe(true);
      const bounds = await widget.boundingBox();
      assert.ok(
        (
          await widget.locator('.y-axis text').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().left))
        ).every((x) => x >= bounds.x),
      );
      results.push({
        engine,
        from,
        actualObservationCount: expected.length,
        sourceValuesPreserved: true,
        datesCorrect: true,
      });
      if (from === '2026-10-01') await page.screenshot({ path: output + '/' + engine + '-october.png' });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    await browser.close();
    browser = null;
  }
  await writeFile(
    output + '/verification.json',
    JSON.stringify({ results, browserErrors: 0, financialWrites: 0 }, null, 2),
  );
  console.log(
    JSON.stringify({
      syntheticCases: results.length,
      monthlyLines: true,
      firstObservationVisible: true,
      missingMonthsUseActualEarlierDate: true,
      calendarDatesCorrect: true,
      axisLabelsFit: true,
      browserErrors: 0,
      financialWrites: 0,
    }),
  );
} finally {
  await browser?.close();
  await unlink(harness).catch(() => {});
}
