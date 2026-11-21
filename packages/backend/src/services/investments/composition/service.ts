import type { FundCompositionStatus, InvestmentFundSnapshot } from '@bt/shared/types/investment-analytics';
import { ValidationError } from '@js/errors';
import BrokerPortfolioData from '@models/investments/broker-portfolio-data.model';
import InvestmentFundSnapshots, {
  type CompositionImportAttempt,
} from '@models/investments/fund-holdings-snapshot.model';
import Holdings from '@models/investments/holdings.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import UserSettings from '@models/user-settings.model';
import {
  fundSnapshotSchema,
  getFundSnapshots,
  latestFundSnapshots,
  saveFundSnapshots,
} from '@services/investments/analytics/fund-snapshots';
import Big from 'big.js';
import { XMLParser } from 'fast-xml-parser';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { literal, Op } from 'sequelize';

import { type CompositionFileInput, MAX_COMPOSITION_BYTES, parseCompositionFile } from './parsers';
import {
  COMPOSITION_REGISTRY,
  definitionFor,
  isCompositionIdentityConflict,
  isFundSecurity,
  secFeedUrl,
} from './registry';
export async function ownedCompositionSecurities(userId: number) {
  const portfolios = await Portfolios.findAll({ where: { userId }, attributes: ['id'] });
  const holdings = await Holdings.findAll({
    where: { portfolioId: { [Op.in]: portfolios.map((p) => p.id) } },
    include: [{ model: Securities, as: 'security' }],
  });
  const settings = await UserSettings.findOne({ where: { userId } });
  const hidden = new Set(settings?.settings.ui?.hiddenPortfolioIds ?? []);
  const conflicts = holdings.filter((h) => h.security && isCompositionIdentityConflict(h.security));
  const brokerRows = conflicts.length
    ? await BrokerPortfolioData.findAll({
        where: { portfolioId: { [Op.in]: [...new Set(conflicts.map((h) => h.portfolioId))] } },
      })
    : [];
  const grouped = new Map<string, { security: Securities; portfolioIds: Set<string> }>();
  for (const h of holdings) {
    if (!h.security || h.quantity.isZero() || !isFundSecurity(h.security)) continue;
    const row = grouped.get(h.securityId) ?? { security: h.security, portfolioIds: new Set<string>() };
    row.portfolioIds.add(h.portfolioId);
    grouped.set(h.securityId, row);
  }
  return [...grouped.values()].map(({ security: s, portfolioIds }) => ({
    id: s.id,
    symbol: s.symbol ?? s.providerSymbol,
    name: s.name ?? s.symbol ?? s.id,
    cusip: s.cusip,
    isin: s.isin,
    excludedFromAnalytics: [...portfolioIds].every((id) => hidden.has(id)),
    identityConflict: isCompositionIdentityConflict(s),
    identityEvidence:
      s.symbol === 'SPCX' &&
      brokerRows.some((row) =>
        row.data.sourceEvents.some(
          (event) => event.symbol === 'SPCX' && /CUSIP:\s*84615Q103/i.test(String(event.description ?? '')),
        ),
      )
        ? 'Imported brokerage source identifies SpaceX, CUSIP 84615Q103. SPCK fund CUSIP 19423L672 is a different security.'
        : undefined,
  }));
}
export async function getCompositionAttempts(userId: number): Promise<CompositionImportAttempt[]> {
  return (
    await InvestmentFundSnapshots.findAll({
      where: { userId, 'data.kind': 'import-attempt' },
      attributes: [[literal("data - 'rawSourceGzipBase64'"), 'data']],
      order: [['createdAt', 'DESC']],
      limit: 250,
    })
  )
    .map((r) => r.data)
    .filter((d): d is CompositionImportAttempt => 'kind' in d && d.kind === 'import-attempt');
}
export function compositionStatuses(
  funds: { id: string; symbol: string; name: string; identityConflict?: boolean; identityEvidence?: string }[],
  snapshots: InvestmentFundSnapshot[],
  attempts: CompositionImportAttempt[] = [],
  scheduleEnabled = false,
): FundCompositionStatus[] {
  return funds.map((fund) => {
    const definition = definitionFor(fund.symbol);
    const snapshot = snapshots.find((s) => s.fundId === fund.id);
    const provenance = snapshot?.provenance;
    const attempt = attempts.find((a) => a.fundId === fund.id && a.refresh);
    const success = attempt && ['imported', 'duplicate'].includes(attempt.status);
    const scheduled = attempts.find((a) => a.fundId === fund.id && a.refreshOrigin === 'scheduled');
    const conflict = !!fund.identityConflict;
    return {
      fundId: fund.id,
      symbol: fund.symbol,
      name: fund.name,
      sourceId:
        provenance?.sourceId ??
        (fund.symbol === 'GLD'
          ? 'sec-gold-facts'
          : definition?.seriesId
            ? 'sec-nport'
            : (definition?.adapter ?? 'canonical-csv')),
      adapter: definition?.adapter ?? 'canonical-csv',
      sourceUrl:
        provenance?.sourceUrl ??
        (definition?.seriesId ? secFeedUrl(definition.seriesId) : (definition?.issuerUrl ?? '')),
      seriesId: definition?.seriesId,
      classId: definition?.classId,
      family: definition?.family,
      status: conflict
        ? 'review'
        : !snapshot
          ? 'missing'
          : new Big(snapshot.coverage).lt('99.999999') || provenance?.unweightedRowCount
            ? 'partial'
            : 'ready',
      asOf: snapshot?.asOf ?? null,
      retrievedAt: snapshot?.retrievedAt ?? null,
      rows: provenance?.parsedRowCount ?? snapshot?.holdings.length ?? 0,
      coverage: snapshot?.coverage ?? '0',
      residual: provenance?.residualWeight ?? (snapshot ? new Big(100).minus(snapshot.coverage).toString() : '100'),
      autoRefreshPermitted: (!!definition?.seriesId || fund.symbol === 'GLD') && !conflict,
      autoRefreshOperational:
        scheduleEnabled && !!scheduled && ['imported', 'duplicate'].includes(scheduled.status) && !conflict,
      lastRefreshRun: attempt?.attemptedAt ?? null,
      scheduledRefreshEnabled: scheduleEnabled && !conflict,
      lastScheduledRun: scheduled?.attemptedAt ?? null,
      nextRefreshDue:
        scheduleEnabled && scheduled ? new Date(Date.parse(scheduled.attemptedAt) + 7 * 86400000).toISOString() : null,
      refreshAsOf: attempt?.asOf ?? null,
      identityEvidence: fund.identityEvidence,
      netWeight: provenance?.netWeight,
      grossWeight: provenance?.grossWeight,
      blocker: conflict
        ? (fund.identityEvidence ??
          'Native SPCX has conflicting identity; verify its brokerage CUSIP/ISIN before linking SPCK.')
        : attempt && !success
          ? (attempt.error ?? 'The last refresh failed. The last usable composition is retained.')
          : !snapshot
            ? definition?.seriesId
              ? 'No imported snapshot. SEC refresh or an issuer file is required.'
              : 'A dated issuer file is required.'
            : null,
      warnings: provenance?.warnings ?? [],
    };
  });
}
export async function getCompositionCatalog(userId: number) {
  const [funds, snapshots, attempts, configuration] = await Promise.all([
    ownedCompositionSecurities(userId),
    getFundSnapshots(userId),
    getCompositionAttempts(userId),
    getCompositionSchedule(userId),
  ]);
  return {
    funds: funds.map((fund) => ({
      ...fund,
      ...compositionStatuses(
        [fund],
        latestFundSnapshots(snapshots, new Date().toISOString().slice(0, 10)),
        attempts,
        configuration?.enabled,
      )[0],
    })),
    sources: COMPOSITION_REGISTRY.map(({ namePattern: _pattern, ...source }) => ({
      ...source,
      secUrl: source.seriesId ? secFeedUrl(source.seriesId) : undefined,
    })),
    schedule: configuration?.enabled
      ? 'SEC disclosures checked weekly per eligible visible fund; due checks daily at 07:15 America/New_York. Issuer exports remain manual.'
      : 'No scheduled composition refresh has been enabled.',
  };
}
export async function getCompositionSchedule(userId: number) {
  const rows = await InvestmentFundSnapshots.findAll({
    where: { userId, 'data.kind': 'refresh-configuration' },
    order: [['createdAt', 'DESC']],
    limit: 1,
  });
  const data = rows[0]?.data;
  return data && 'kind' in data && data.kind === 'refresh-configuration' ? data : null;
}
export async function saveCompositionSchedule(userId: number, contact: string, enabled: boolean) {
  const id = createHash('sha256').update(`${userId}:${randomUUID()}`).digest('hex');
  await InvestmentFundSnapshots.create({
    id,
    userId,
    data: { kind: 'refresh-configuration', enabled, contact, updatedAt: new Date().toISOString() },
  });
  return { enabled, schedule: 'Due checks daily at 07:15 America/New_York; each eligible SEC source at most weekly.' };
}
async function attemptRecord(userId: number, data: Omit<CompositionImportAttempt, 'kind' | 'attemptedAt'>) {
  const id = createHash('sha256').update(`${userId}:${randomUUID()}`).digest('hex');
  await InvestmentFundSnapshots.create({
    id,
    userId,
    data: { ...data, kind: 'import-attempt', attemptedAt: new Date().toISOString() },
  });
}
export async function inspectComposition({
  userId,
  input,
  commit = false,
  refresh = false,
}: {
  userId: number;
  input: CompositionFileInput;
  commit?: boolean;
  refresh?: boolean;
}) {
  const funds = await ownedCompositionSecurities(userId);
  const fund = funds.find((s) => s.id === input.fundId);
  if (!fund || fund.symbol !== input.symbol)
    throw new ValidationError({ message: 'Choose an owned fund from the composition inventory.' });
  if (fund.identityConflict)
    throw new ValidationError({
      message:
        'SPCX has conflicting native security identity. Verify the brokerage CUSIP/ISIN before attaching SPCK composition.',
    });
  let snapshot: InvestmentFundSnapshot;
  try {
    snapshot = await parseCompositionFile(input);
    fundSnapshotSchema.parse(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The source could not be validated.';
    const bytes = Buffer.from(input.base64, 'base64');
    await attemptRecord(userId, {
      fundId: fund.id,
      symbol: fund.symbol,
      sourceId: input.adapter,
      sourceUrl: input.sourceUrl,
      status: 'quarantined',
      error: message.slice(0, 1000),
      refresh,
      ...(bytes.length && bytes.length <= MAX_COMPOSITION_BYTES
        ? {
            sha256: createHash('sha256').update(bytes).digest('hex'),
            rawSourceGzipBase64: gzipSync(bytes).toString('base64'),
          }
        : {}),
    });
    throw new ValidationError({ message: `Composition quarantined: ${message}` });
  }
  let result: { inserted: number; duplicates: number } | undefined;
  if (commit) {
    result = await saveFundSnapshots({ userId, snapshots: [snapshot] });
    await attemptRecord(userId, {
      fundId: fund.id,
      symbol: fund.symbol,
      sourceId: input.adapter,
      sourceUrl: snapshot.provenance?.sourceUrl,
      sha256: snapshot.provenance?.sha256,
      status: result.inserted ? 'imported' : 'duplicate',
      asOf: snapshot.asOf,
      rows: snapshot.provenance?.parsedRowCount,
      coverage: snapshot.coverage,
      refresh,
    });
  }
  return {
    snapshot: {
      ...snapshot,
      provenance: snapshot.provenance ? { ...snapshot.provenance, rawSourceGzipBase64: undefined } : undefined,
    },
    result,
  };
}

// A single process-wide queue enforces SEC fair access across simultaneous owners/requests.
let secQueue: Promise<unknown> = Promise.resolve();
let secBlockedUntil = 0;
export async function fetchSec(url: string, contact: string): Promise<Buffer> {
  const parsed = new URL(url);
  const goldFacts =
    parsed.hostname === 'data.sec.gov' && parsed.pathname === '/api/xbrl/companyfacts/CIK0001222333.json';
  if (
    parsed.protocol !== 'https:' ||
    (!goldFacts &&
      (parsed.hostname !== 'www.sec.gov' ||
        (!parsed.pathname.startsWith('/Archives/edgar/') && parsed.pathname !== '/cgi-bin/browse-edgar')))
  )
    throw new Error('Only registered public SEC filing URLs can be fetched.');
  const task = secQueue
    .catch(() => undefined)
    .then(async () => {
      if (Date.now() < secBlockedUntil)
        throw new Error(
          'SEC access is paused after an access restriction. Use a manual download; no retry or bypass was attempted.',
        );
      await new Promise((resolve) => setTimeout(resolve, 1300));
      const response = await fetch(url, {
        headers: {
          'User-Agent': `MoneyMatter personal composition analytics ${contact}`,
          Accept: 'application/xml,text/xml,*/*',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      if ([403, 429].includes(response.status)) secBlockedUntil = Date.now() + 24 * 60 * 60 * 1000;
      if (!response.ok) throw new Error(`SEC returned HTTP ${response.status}; last usable composition retained.`);
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (!response.body) throw new Error('SEC response has no file content.');
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_COMPOSITION_BYTES) {
          await response.body.cancel().catch(() => undefined);
          throw new Error('SEC file exceeds the bounded import size.');
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    });
  secQueue = task;
  return task;
}
export async function refreshSecComposition({
  userId,
  fundIds,
  contact,
  origin = 'on-demand',
}: {
  userId: number;
  fundIds: string[];
  contact: string;
  origin?: 'on-demand' | 'scheduled';
}) {
  const funds = await ownedCompositionSecurities(userId);
  if (fundIds.some((id) => !funds.some((f) => f.id === id)))
    throw new ValidationError({ message: 'The selection includes an unavailable fund.' });
  const results: {
    fundId: string;
    symbol: string;
    status: string;
    error?: string;
    asOf?: string;
    coverage?: string;
    rows?: number;
  }[] = [];
  const files = new Map<string, { bytes: Buffer; url: string }>();
  for (const fund of funds.filter((f) => fundIds.includes(f.id))) {
    const definition = definitionFor(fund.symbol);
    if ((!definition?.seriesId && fund.symbol !== 'GLD') || fund.identityConflict) {
      results.push({
        fundId: fund.id,
        symbol: fund.symbol,
        status: 'manual-required',
        error: fund.identityConflict ? 'Fund identity needs review.' : 'This fund has no registered SEC N-PORT series.',
      });
      continue;
    }
    try {
      const seriesKey = definition?.seriesId ?? 'GLD';
      let file = files.get(seriesKey);
      if (!file) {
        if (fund.symbol === 'GLD') {
          const url = 'https://data.sec.gov/api/xbrl/companyfacts/CIK0001222333.json';
          file = { bytes: await fetchSec(url, contact), url };
        } else {
          const feed = await fetchSec(secFeedUrl(definition!.seriesId!), contact);
          const parsed = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
            parseTagValue: false,
          }).parse(feed.toString('utf8'));
          const entry = [parsed.feed?.entry]
            .flat()
            .find((e) => /^NPORT-P(?:\/A)?$/.test(e?.content?.['filing-type'] ?? ''));
          const filingUrl = entry?.content?.['filing-href'];
          if (!filingUrl) throw new Error('No public N-PORT filing was returned for the registered series.');
          const url = String(filingUrl).replace(/[^/]+-index\.html?$/, 'primary_doc.xml');
          file = { bytes: await fetchSec(url, contact), url };
        }
        files.set(seriesKey, file);
      }
      const { snapshot, result } = await inspectComposition({
        userId,
        commit: true,
        refresh: true,
        input: {
          fundId: fund.id,
          symbol: fund.symbol,
          adapter: fund.symbol === 'GLD' ? 'sec-gold-facts' : 'sec-nport',
          fileName: fund.symbol === 'GLD' ? 'companyfacts.json' : 'primary_doc.xml',
          sourceUrl: file.url,
          base64: file.bytes.toString('base64'),
          refreshRunAt: new Date().toISOString(),
        },
      });
      results.push({
        fundId: fund.id,
        symbol: fund.symbol,
        status: result?.inserted ? 'imported' : 'duplicate',
        asOf: snapshot.asOf,
        coverage: snapshot.coverage,
        rows: snapshot.provenance?.parsedRowCount,
      });
      if (origin === 'scheduled')
        await attemptRecord(userId, {
          fundId: fund.id,
          symbol: fund.symbol,
          sourceId: snapshot.provenance?.sourceId ?? 'sec-nport',
          sourceUrl: snapshot.provenance?.sourceUrl,
          status: result?.inserted ? 'imported' : 'duplicate',
          asOf: snapshot.asOf,
          rows: snapshot.provenance?.parsedRowCount,
          coverage: snapshot.coverage,
          refresh: true,
          refreshOrigin: 'scheduled',
        });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : 'SEC refresh failed.';
      await attemptRecord(userId, {
        fundId: fund.id,
        symbol: fund.symbol,
        sourceId: 'sec-nport',
        sourceUrl: definition?.seriesId
          ? secFeedUrl(definition.seriesId)
          : 'https://data.sec.gov/api/xbrl/companyfacts/CIK0001222333.json',
        status: 'failed',
        error: message,
        refresh: true,
        refreshOrigin: origin,
      });
      results.push({ fundId: fund.id, symbol: fund.symbol, status: 'failed', error: message });
      if (Date.now() < secBlockedUntil) break;
    }
  }
  return { results };
}
