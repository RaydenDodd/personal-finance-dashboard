import assert from 'node:assert/strict';
// Checks private imported values in memory; output contains counts and pass/fail only.
import { readFile } from 'node:fs/promises';
const base = process.env.FINANCE_URL || 'http://localhost:8095';
const parsedBase = new URL(base);
if (parsedBase.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsedBase.hostname)) {
  throw new Error('Use a localhost SSH tunnel or HTTPS');
}
async function main() {
  const expected = JSON.parse(await readFile('private/networth-history.json', 'utf8'));
  const credentials = JSON.parse(await readFile('private/owner-credentials.json', 'utf8'));
  const signIn = await fetch(`${base}/api/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: parsedBase.origin },
    body: JSON.stringify({ email: credentials.email, password: credentials.password }),
  });
  assert.equal(signIn.status, 200, 'Owner authentication');
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  async function get(path) {
    const response = await fetch(`${base}${path}`, { headers: { cookie } });
    assert.equal(response.status, 200, 'Authenticated read');
    return (await response.json()).response;
  }
  const dashboard = await get('/api/v1/personal-finance/dashboard?granularity=monthly');
  const revisions = await get('/api/v1/personal-finance/snapshots/revisions');
  const sourceRecords = revisions.filter((s) => s.sourceId === expected.sourceId);
  assert.equal(sourceRecords.length, expected.records.length, 'Imported observation count');
  const mapped = new Map(
    expected.accounts.map((a) => {
      const matching = dashboard.accounts.filter((b) => b.name === a.name && b.currencyCode === a.currencyCode);
      assert.equal(matching.length, 1, 'Unambiguous account mapping');
      return [a.key, matching[0]];
    }),
  );
  const toCents = (value) => Math.round(value * 100);
  for (const record of expected.records) {
    const saved = sourceRecords.filter((s) => s.sourceKey === record.sourceKey);
    assert.equal(saved.length, 1, 'Stable source identity');
    assert.equal(saved[0].accountId, mapped.get(record.accountKey).id, 'Canonical account');
    assert.equal(saved[0].date, record.date, 'Actual recorded date');
    assert.equal(toCents(saved[0].balance), toCents(record.balance), 'Exact recorded balance');
    assert.equal(saved[0].formula || undefined, record.formula, 'Formula provenance');
    assert.equal(saved[0].currencyCode, record.currencyCode, 'Currency');
  }
  const periods = new Map();
  for (const r of expected.records) {
    const key = r.date.slice(0, 7),
      period = periods.get(key) || new Map();
    const prior = period.get(r.accountKey);
    if (!prior || r.date > prior.date) period.set(r.accountKey, r);
    periods.set(key, period);
  }
  for (const [month, records] of periods) {
    const point = dashboard.history.find((p) => p.date.slice(0, 7) === month);
    assert.ok(point, 'Historical month remains available');
    let total = 0;
    const categories = {};
    for (const a of dashboard.accounts.filter((a) => a.included)) {
      const sourceAccount = [...mapped.entries()].find(([, target]) => target.id === a.id)?.[0];
      const record = records.get(sourceAccount);
      assert.equal(point.balances[a.id] === null, !record, 'Missing stays missing');
      if (!record) continue;
      const value = toCents(record.balance) * (a.balanceKind === 'liability' ? -1 : 1);
      total += value;
      categories[a.categoryId] = (categories[a.categoryId] || 0) + value;
      assert.equal(point.valuationDates[a.id], record.date, 'Per-account valuation date');
    }
    assert.equal(toCents(point.knownTotal), total, 'Category/account aggregation');
    for (const [id, value] of Object.entries(categories))
      assert.equal(toCents(point.categories[id]), value, 'Category total');
    assert.equal(
      point.complete,
      records.size === dashboard.accounts.filter((a) => a.included).length,
      'Month completeness',
    );
    assert.equal(point.total === null, !point.complete, 'Partial total never implies zero');
  }
  assert.ok(
    dashboard.accounts.every((a) => a.principal === null && a.gain === null),
    'No invented historical principal or gains',
  );
  const anonymous = await fetch(`${base}/api/v1/personal-finance/dashboard`);
  assert.equal(anonymous.status, 401, 'Unauthenticated finance data rejected');
  console.log(
    JSON.stringify({
      historicalImport: 'passed',
      observations: sourceRecords.length,
      accounts: mapped.size,
      recordedDates: new Set(expected.records.map((r) => r.date)).size,
      valueAndFormulaPreservation: 'passed',
      categoryTotals: 'passed',
      missingBalances: 'passed',
      principalNotInferred: 'passed',
      authentication: 'passed',
    }),
  );
}
main().catch(() => {
  console.error('Historical import verification failed; sensitive assertion details suppressed.');
  process.exitCode = 1;
});
