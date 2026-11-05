// Private data stays in ignored input/output files. Never log response bodies or credentials.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
}
const base = new URL(option('--url', 'http://localhost:8095'));
if (!['http:', 'https:'].includes(base.protocol)) throw new Error('HTTP(S) URL required');
if (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
  throw new Error('Use an SSH tunnel to localhost or private HTTPS for the import');
}
const inputPath = option('--input', 'private/networth-history.json');
const credentialsPath = option('--credentials', 'private/owner-credentials.json');
const previewPath = option('--preview', 'private/networth-import-preview.json');
const apply = args.includes('--apply');
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
if (!Array.isArray(input.accounts) || !Array.isArray(input.records) || !input.sourceId)
  throw new Error('Normalized import JSON required');
let cookie = '';
async function request(path, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: base.origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) cookie = cookies.map((c) => c.split(';')[0]).join('; ');
  if (!response.ok)
    throw new Error(`Request failed (${response.status}) at ${path}; response details withheld from logs`);
  const result = await response.json();
  return result.response ?? result;
}
await request('/api/v1/auth/sign-in/email', { email: credentials.email, password: credentials.password });
const dashboard = await request('/api/v1/personal-finance/dashboard');
const accountMap = new Map();
const categories = new Set(dashboard.categories.map((c) => c.id));
for (const account of input.accounts) {
  if (!categories.has(account.categoryId)) throw new Error('Source category requires manual mapping in the app');
  const matches = dashboard.accounts.filter((a) => a.name === account.name && a.currencyCode === account.currencyCode);
  if (matches.length > 1) throw new Error('Ambiguous reporting account names; resolve mappings in the application');
  let target = matches[0];
  if (!target) {
    if (!args.includes('--prepare') && !apply)
      throw new Error('Empty reporting accounts must be prepared first with --prepare');
    target = await request('/api/v1/personal-finance/accounts', {
      name: account.name,
      currencyCode: account.currencyCode,
      categoryId: account.categoryId,
      included: account.included,
      balanceKind: account.balanceKind,
      preferredSource: 'manual',
      description:
        account.note || 'Historical manually maintained worksheet account; recorded valuation dates preserved.',
    });
  }
  if (!target.id) throw new Error('Server did not return reporting account ID');
  accountMap.set(account.key, target.id);
}
const payload = {
  sourceId: input.sourceId,
  records: input.records.map((record) => {
    const accountId = accountMap.get(record.accountKey);
    if (!accountId || !Number.isFinite(record.balance)) throw new Error('Invalid record or unresolved account');
    return {
      sourceKey: record.sourceKey,
      accountId,
      date: record.date,
      balance: record.balance,
      currencyCode: record.currencyCode,
      sourceLabel: record.sourceLabel,
      ...(record.formula ? { formula: record.formula } : {}),
      verified: record.verified !== false,
    };
  }),
};
const preview = await request('/api/v1/personal-finance/import/preview', payload);
await mkdir(dirname(resolve(previewPath)), { recursive: true });
await writeFile(
  previewPath,
  JSON.stringify(
    {
      sourceId: input.sourceId,
      generatedAt: new Date().toISOString(),
      notes: input.notes,
      warnings: input.warnings,
      ...preview,
    },
    null,
    2,
  ) + '\n',
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    stage: 'preview',
    accounts: accountMap.size,
    observations: payload.records.length,
    counts: preview.counts,
    previewFile: resolve(previewPath),
  }),
);
if (apply) {
  if (!preview.previewToken) throw new Error('Server did not return preview token');
  const result = await request('/api/v1/personal-finance/import/commit', {
    ...payload,
    previewToken: preview.previewToken,
  });
  console.log(JSON.stringify({ stage: 'committed', counts: result.counts ?? result }));
} else console.log('Preview saved. Review it privately, then rerun with --apply to import.');
