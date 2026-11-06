import { chromium, webkit, expect } from '@playwright/test';
// Synthetic shared-shell QA only. All API traffic is intercepted; no owner data or sessions.
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.PERSONAL_FINANCE_QA_URL ?? 'http://127.0.0.1:8110';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Use a loopback preview.');
const harness = path.join(root, 'packages/frontend/__qa-finance-shell.html'),
  output = path.join(root, 'private/qa-shell');
await mkdir(output, { recursive: true });
await writeFile(
  harness,
  `<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><script>window.__APP_CONFIG__={IS_SELF_HOST:'true',API_HTTP:location.origin,API_VER:'/api/v1'};</script></head><body><div id="app"></div><script type="module">
import '/src/styles/global.css';
import '/src/app.vue'; // Match the application entry's overlay/API initialization order.
import {createApp,h} from 'vue';import {createHead} from '@unhead/vue/client';
import {createRouter,createMemoryHistory,RouterView} from 'vue-router';
import {VueQueryPlugin,QueryClient} from '@tanstack/vue-query';
import {store} from '/src/stores/setup';import {useCurrenciesStore} from '/src/stores/currencies';
import {i18n,loadChunks} from '/src/i18n';import {ROUTES_NAMES} from '/src/routes/constants';
import BottomNavbar from '/src/components/bottom-navbar.vue';import UiHeader from '/src/components/ui-header.vue';
import Overlay from '/src/components/common/connection-status-overlay.vue';
import {isConnectionBlocked,markConnectionUnavailable} from '/src/lib/connection-status';
import {installVisualViewportSizing} from '/src/common/utils/visual-viewport';
import {preparePrivateClientStorage} from '/src/registerServiceWorker';
const map={[ROUTES_NAMES.personalFinance]:'/personal-finance',[ROUTES_NAMES.home]:'/dashboard',[ROUTES_NAMES.accounts]:'/accounts',[ROUTES_NAMES.transactions]:'/transactions',[ROUTES_NAMES.analyticsNetWorthHistory]:'/analytics/net-worth-history'};
const router=createRouter({history:createMemoryHistory(),routes:Object.values(ROUTES_NAMES).map((name,index)=>({name,path:map[name]??'/qa-'+index,component:{render:()=>h('p',{class:'p-4'},'Synthetic route')},meta:{navSection:name===ROUTES_NAMES.accounts?'accounts':name===ROUTES_NAMES.transactions?'transactions':undefined}}))});
await loadChunks({locale:'en',chunks:['layout','dialogs']});
await router.push('/personal-finance');
const app=createApp({setup:()=>()=>h('div',{},[!isConnectionBlocked.value?h('div',{class:'finance-app-shell bg-background flex h-dvh min-h-0 flex-col'},[h(UiHeader,{class:'finance-app-header'}),h('main',{class:'flex-1 overflow-y-auto p-4'},[h('h1','Synthetic My Finances'),h(RouterView),...Array.from({length:14},(_,i)=>h('p',{class:'my-4'},'Private financial placeholder '+(i+1)))]),h(BottomNavbar)]):null,h(Overlay)])});
app.use(store);app.use(i18n);app.use(router);app.use(createHead());app.use(VueQueryPlugin,{queryClient:new QueryClient({defaultOptions:{queries:{retry:false}}})});
useCurrenciesStore().baseCurrency={id:1,currencyCode:'USD',code:'USD',symbol:'$'};await preparePrivateClientStorage();installVisualViewportSizing();
app.mount('#app');window.__qaRouter=router;window.__qaMark=markConnectionUnavailable;
</script></body></html>`,
);
let browser;
let stage = 'start';
const errors = [],
  writes = [];
try {
  browser =
    process.env.FINANCE_QA_BROWSER === 'webkit'
      ? await webkit.launch({ headless: true })
      : await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  });
  await context.route('**/api/v1/**', async (route) => {
    if (route.request().method() !== 'GET') writes.push(route.request().method());
    const pathname = new URL(route.request().url()).pathname;
    let response = [];
    if (pathname.endsWith('/user/settings')) response = {};
    if (pathname.includes('/auth/get-session')) return route.fulfill({ json: null });
    await route.fulfill({ json: { status: 'success', response } });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  stage = 'mobile-navigation';
  await page.goto(base + '/__qa-finance-shell.html');
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(nav).toBeVisible({ timeout: 30000 });
  await expect(nav.getByRole('link')).toHaveCount(4);
  for (const [label, url] of [
    ['Accounts', '/accounts'],
    ['Transactions', '/transactions'],
    ['Reports', '/analytics/net-worth-history'],
    ['Finances', '/personal-finance'],
  ]) {
    await nav.getByRole('link', { name: label, exact: true }).tap();
    await expect.poll(() => page.evaluate(() => window.__qaRouter.currentRoute.value.fullPath)).toBe(url);
  }
  stage = 'more-navigation';
  await nav.getByRole('button', { name: 'More navigation' }).tap();
  const more = page.getByRole('dialog', { name: 'More navigation', exact: true });
  await expect(more).toBeVisible();
  await more.getByRole('link', { name: 'Dashboard', exact: true }).tap();
  await expect(more).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__qaRouter.currentRoute.value.fullPath)).toBe('/dashboard');
  stage = 'native-transaction-form';
  await page.getByRole('button', { name: 'Add', exact: true }).tap();
  const transactionDialog = page.getByRole('dialog').first();
  await expect(transactionDialog).toBeVisible({ timeout: 30000 });
  const dialogBounds = await transactionDialog.boundingBox();
  if (dialogBounds.width > 390 || dialogBounds.height > 844) throw Error('Transaction form exceeds phone viewport');
  await page.keyboard.press('Escape');
  await expect(transactionDialog).toHaveCount(0);
  stage = 'small-and-landscape';
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 812 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect
      .poll(async () => {
        const bar = await page.getByTestId('mobile-bottom-bar').boundingBox();
        return Math.abs(bar.y + bar.height - viewport.height);
      })
      .toBeLessThanOrEqual(1);
    const targets = await nav
      .locator('a,button')
      .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
    if (targets.some((h) => h < 44)) throw Error('Navigation touch target too small');
  }
  stage = 'dark-and-light';
  await page.setViewportSize({ width: 390, height: 844 });
  stage = 'installed-safe-area-padding';
  for (const inset of [0, 21, 34, 83]) {
    await page.evaluate((inset) => {
      document.documentElement.setAttribute('data-finance-standalone', '');
      document
        .querySelector('[data-testid="mobile-bottom-bar"]')
        .style.setProperty('--finance-nav-safe-area-bottom', `${inset}px`);
    }, inset);
    const bar = await page.getByTestId('mobile-bottom-bar').boundingBox();
    const controls = await nav.boundingBox();
    const padding = bar.y + bar.height - controls.y - controls.height;
    if (Math.abs(padding - Math.max(4, Math.min(inset, 34))) > 1)
      throw Error('Installed tab controls have excessive bottom padding');
    if (Math.abs(bar.y + bar.height - 844) > 1) throw Error('Installed tab bar does not reach the viewport bottom');
    if (inset === 83) await page.screenshot({ path: path.join(output, 'mobile-installed-inset-83.png') });
  }
  await page.evaluate(() => {
    document.documentElement.removeAttribute('data-finance-standalone');
    document.querySelector('[data-testid="mobile-bottom-bar"]').style.removeProperty('--finance-nav-safe-area-bottom');
  });
  stage = 'dark-and-light';
  await page.screenshot({ path: path.join(output, 'mobile-dark.png') });
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
  });
  await page.screenshot({ path: path.join(output, 'mobile-light.png') });
  stage = 'offline-mask';
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByTestId('connection-status-overlay')).toBeVisible();
  await expect(page.getByText('Private financial placeholder 1', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  if (errors.length) throw Error('Browser errors: ' + errors.join(';'));
  if (writes.length) throw Error('Unexpected synthetic writes');
  const result = {
    mobileNavigation: true,
    moreMenu: true,
    viewportWidths: [320, 375, 390, 430, 844],
    darkAndLight: true,
    touchTargets: true,
    installedSafeAreaInsets: [0, 21, 34, 83],
    nativeTransactionForm: true,
    offlineHidesFinancialViews: true,
    browserErrors: 0,
    financialWrites: 0,
  };
  await writeFile(path.join(output, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ sharedShellQA: 'failed', stage, message: error.message, browserErrors: errors }));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await unlink(harness).catch(() => {});
}
