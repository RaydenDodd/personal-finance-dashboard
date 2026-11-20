import { collectAdpPayroll, withTemporaryAdpBrowser } from './adp-payroll-export.mjs';

/** A fresh browser belongs to this user gesture only. Login/MFA are never automated or inspected. */
export async function runInteractiveAdpSync({
  chromium,
  signal,
  status = () => {},
  loginTimeoutMs = 600_000,
  collectionOptions = {},
}) {
  return withTemporaryAdpBrowser(chromium, process.platform === 'win32' ? 'msedge' : 'chromium', async (context) => {
    if (signal?.aborted) throw new Error('Cancelled');
    const page = await context.newPage();
    const cancel = () => {
      void context.close();
    };
    signal?.addEventListener('abort', cancel, { once: true });
    let timer,
      navigation,
      resolveWorker,
      rejectWorker,
      payOpened = false,
      probing = false;
    const worker = new Promise((resolve, reject) => {
      resolveWorker = resolve;
      rejectWorker = reject;
    });
    // Attach rejection handling before navigation, so a cancelled popup never leaks a rejected promise.
    void worker.catch(() => {});
    const response = (value) => {
      const url = new URL(value.url());
      const match = /^\/myadp_prefix\/payroll\/v1\/workers\/([a-zA-Z0-9._~-]{1,250})\/pay-statements\/?$/.exec(
        url.pathname,
      );
      if (
        url.origin === 'https://my.adp.com' &&
        match &&
        value.status() === 200 &&
        (value.headers()['content-type'] ?? '').includes('json')
      )
        resolveWorker({ workerId: match[1], page: value.frame().page() });
    };
    context.on('response', response);
    page.on('close', () => rejectWorker(new Error('Cancelled')));
    try {
      timer = setTimeout(() => rejectWorker(new Error('ADP sign-in timed out')), loginTimeoutMs);
      status('sign-in');
      await page.goto('https://my.adp.com/', { waitUntil: 'domcontentloaded' });
      // Normal Pay navigation only, once available after the owner's login. No guessed route or login-field access.
      navigation = setInterval(async () => {
        if (probing || payOpened || new URL(page.url()).origin !== 'https://my.adp.com') return;
        probing = true;
        try {
          for (const role of ['link', 'button']) {
            for (const pay of await page.getByRole(role, { name: /^(Pay|Pay statements)$/i }).all()) {
              if (await pay.isVisible()) {
                payOpened = true;
                await pay.click({ timeout: 2000 });
                break;
              }
            }
            if (payOpened) break;
          }
        } catch {
          /* The owner can open Pay statements directly if the website's navigation differs. */
        } finally {
          probing = false;
        }
      }, 1000);
      const ready = await worker;
      clearTimeout(timer);
      clearInterval(navigation);
      if (signal?.aborted) throw new Error('Cancelled');
      status('collecting');
      return await ready.page.evaluate(collectAdpPayroll, { ...collectionOptions, workerId: ready.workerId });
    } finally {
      clearTimeout(timer);
      clearInterval(navigation);
      signal?.removeEventListener('abort', cancel);
      context.off('response', response);
    }
  });
}
