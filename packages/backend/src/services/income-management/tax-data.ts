import { TAX_RULES_2026 } from '@bt/shared/finance-income';
import { connection } from '@models/index';
import { createHash, randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';

export async function getTaxData(userId: number) {
  const checks = await connection.sequelize.query(
    'SELECT details,"createdAt" FROM "PersonalFinanceAudit" WHERE "userId"=:userId AND action=\'tax.sources.checked\' ORDER BY "createdAt" DESC LIMIT 1',
    { replacements: { userId }, type: QueryTypes.SELECT, logging: false },
  );
  return {
    rules: [TAX_RULES_2026],
    latestCheck: checks[0] ?? null,
    policy:
      'Published tax-year rules are versioned and cached. Refresh checks authoritative sources for changes; changed source pages require validated rule updates and never silently overwrite historical rules.',
  };
}
export async function refreshTaxSources(userId: number) {
  const previous = await getTaxData(userId);
  const prior = new Map<string, string>(
    (previous.latestCheck?.details?.sources ?? []).map((s: { url: string; hash: string }) => [s.url, s.hash]),
  );
  const urls = [
    ...new Set(
      [...TAX_RULES_2026.sources, ...Object.values(TAX_RULES_2026.states).flatMap((s) => s.sources)].map((s) => s.url),
    ),
  ];
  const sources: { url: string; checkedAt: string; status: string; hash?: string; changed: boolean }[] = [];
  for (const url of urls.slice(0, 30)) {
    const host = new URL(url).hostname;
    if (
      !url.startsWith('https://') ||
      ![
        'irs.gov',
        'ssa.gov',
        'virginia.gov',
        'dc.gov',
        'marylandtaxes.gov',
        'marylandcomptroller.gov',
        'wv.gov',
        'wvlegislature.gov',
        'ncdor.gov',
      ].some((domain) => host === domain || host.endsWith('.' + domain))
    )
      continue;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(12000),
        redirect: 'error',
        headers: { 'User-Agent': 'MoneyMatter tax-source check' },
      });
      if (!response.ok) throw new Error('Source not available');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > 12_000_000) throw new Error('Source exceeds inspection size limit');
      const hash = createHash('sha256').update(buffer).digest('hex');
      sources.push({
        url,
        checkedAt: new Date().toISOString(),
        status: 'checked',
        hash,
        changed: prior.has(url) && prior.get(url) !== hash,
      });
    } catch {
      sources.push({ url, checkedAt: new Date().toISOString(), status: 'unavailable', changed: false });
    }
  }
  const details = {
    checkedAt: new Date().toISOString(),
    taxYear: 2026,
    sources,
    rulesChanged: false,
    reviewRequired: sources.some((s) => s.changed),
    note: 'HTML/PDF source changes are not automatically converted into tax rules. Cached published rules remain available.',
  };
  await connection.sequelize.query(
    'INSERT INTO "PersonalFinanceAudit" (id,"userId",action,"entityId",details) VALUES (:id,:userId,\'tax.sources.checked\',\'2026\',CAST(:details AS jsonb))',
    { replacements: { id: randomUUID(), userId, details: JSON.stringify(details) }, logging: false },
  );
  return details;
}
