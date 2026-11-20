/** User-operated, one-shot local export. No server login, saved browser profile or credentials. */
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { collectAdpPayroll, withTemporaryAdpBrowser } from './lib/adp-payroll-export.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'node scripts/export-adp-payroll.mjs [--output /private/path/payroll.json] [--channel msedge|chrome|chromium]',
  );
  process.exit(0);
}
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing ${name} value`);
  return args[i + 1];
};
const destination = path.resolve(option('--output', path.join('private', 'adp-payroll-export.json')));
const channel = option('--channel', process.platform === 'win32' ? 'msedge' : 'chromium');
if (!['msedge', 'chrome', 'chromium'].includes(channel)) throw new Error('Choose msedge, chrome or chromium.');
const prompt = createInterface({ input: stdin, output: stdout });
let context;
let aborted = false;
process.once('SIGINT', () => {
  aborted = true;
  void context?.close();
  prompt.close();
});
try {
  await withTemporaryAdpBrowser(chromium, channel, async (temporaryContext) => {
    context = temporaryContext;
    // Nonpersistent context: never use launchPersistentContext, storageState, traces, HAR or screenshots.
    const page = await context.newPage();
    let discoveredWorker;
    page.on('request', (request) => {
      const url = new URL(request.url());
      const match = /^\/myadp_prefix\/payroll\/v1\/workers\/([^/]+)\/pay-statements(?:\/|$)/.exec(url.pathname);
      if (url.origin === 'https://my.adp.com' && match) discoveredWorker = decodeURIComponent(match[1]);
    });
    await page.goto('https://my.adp.com/', { waitUntil: 'domcontentloaded' });
    console.log(
      'Sign in directly in the temporary official ADP window and complete MFA yourself. Open Pay statements.',
    );
    console.log(
      'This helper never reads your login inputs or saves your session. It will not bypass login or access restrictions.',
    );
    const answer = await prompt.question(
      'When ready, type EXPORT to retrieve your own payroll once, or press Enter to cancel: ',
    );
    if (answer !== 'EXPORT' || aborted) process.exitCode = 0;
    else {
      const workerId =
        discoveredWorker ?? (await prompt.question('Worker ID from your own pay-statement URL (not saved): ')).trim();
      if (!workerId || !/^[a-zA-Z0-9._~-]{1,250}$/.test(workerId))
        throw new Error('No valid worker ID supplied. Nothing exported.');
      const adp = context.pages().find((p) => {
        try {
          return new URL(p.url()).origin === 'https://my.adp.com';
        } catch {
          return false;
        }
      });
      if (!adp) throw new Error('Official MyADP session not present. Nothing exported.');
      // Runs inside ADP origin. Cookies remain browser-owned and are never read or transferred to Node/MoneyMatter.
      const result = await adp.evaluate(collectAdpPayroll, { workerId });
      await fs.mkdir(path.dirname(destination), { recursive: true });
      // Never overwrite a previous payroll export. Windows users should store this in the ignored private folder.
      await fs.writeFile(destination, JSON.stringify(result), { flag: 'wx', mode: 0o600 });
      console.log(
        `Exported ${result.payStatements.length} statements to your selected private file. Import it in Actual Income → Manage payroll.`,
      );
    }
  });
} catch (error) {
  console.error(
    error instanceof Error && /^(ADP |Official |No valid|Unrecognized |Missing, duplicate|EEXIST:)/.test(error.message)
      ? error.message
      : 'Export stopped. No credentials were stored. Check the official ADP window and try again manually.',
  );
  process.exitCode = 1;
} finally {
  prompt.close();
}
