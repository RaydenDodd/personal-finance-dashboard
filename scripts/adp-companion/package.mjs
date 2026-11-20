import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
const root = path.resolve('private/adp-companion-package');
await fs.mkdir(root + '/scripts/adp-companion', { recursive: true });
await fs.mkdir(root + '/scripts/lib', { recursive: true });
await fs.mkdir(root + '/node_modules', { recursive: true });
for (const file of ['native-host.mjs', 'config.json'])
  await fs.copyFile('scripts/adp-companion/' + file, root + '/scripts/adp-companion/' + file);
for (const file of ['adp-interactive-sync.mjs', 'adp-payroll-export.mjs'])
  await fs.copyFile('scripts/lib/' + file, root + '/scripts/lib/' + file);
await fs.cp('scripts/adp-companion/extension', root + '/extension', { recursive: true });
await fs.cp('node_modules/playwright-core', root + '/node_modules/playwright-core', { recursive: true });
await fs.copyFile('scripts/adp-companion/install.ps1', root + '/install.ps1');
await fs.copyFile('LICENSE', root + '/LICENSE');
await fs.writeFile(
  root + '/README.txt',
  'MoneyMatter ADP Companion (Windows / Edge or Chrome)\r\n\r\nRequires existing Node.js and Microsoft Edge.\r\n1. Extract this archive. Run install.ps1 with PowerShell (no administrator rights needed).\r\n2. Open edge://extensions (or chrome://extensions), enable Developer mode and Load unpacked.\r\n   Choose %LOCALAPPDATA%\\MoneyMatter\\ADPCompanion\\extension.\r\n3. Reload MoneyMatter. Choose Open ADP and sync; sign in/MFA directly at ADP.\r\n\r\nNo scheduled service, passwords, MFA inputs, cookies or browser profiles are saved.\r\nOnly https://raydenfinance.duckdns.org can invoke this companion.\r\nClosing/cancelling the sync closes its temporary ADP browser.\r\n\r\nThe extension has only nativeMessaging permission. It cannot inspect your normal browser tabs or cookies.\r\nThe included Playwright Core retains its upstream LICENSE and NOTICE.\r\n',
);
if (process.argv.includes('--publish')) {
  const require = createRequire(new URL('../../packages/frontend/package.json', import.meta.url));
  const AdmZip = require('adm-zip');
  await fs.mkdir('packages/frontend/public/downloads', { recursive: true });
  const zip = new AdmZip();
  zip.addLocalFolder(root);
  zip.writeZip('packages/frontend/public/downloads/moneymatter-adp-companion.zip');
}
console.log(
  'Prepared the desktop companion package. Requires existing Node.js and Edge; no ADP credentials are stored.',
);
