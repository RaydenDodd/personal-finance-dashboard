import type { InvestmentAnalytics } from '@bt/shared/types/investment-analytics';
import {
  type InvestmentAnalyticsReadResponse,
  type InvestmentAnalyticsSection,
  omittedAnalyticsFields,
  projectInvestmentAnalytics,
} from '@bt/shared/types/investment-analytics-read';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import Portfolios from '@models/investments/portfolios.model';
import UserSettings from '@models/user-settings.model';
import { createHash } from 'crypto';
import { redisClient } from '@root/redis-client';
import * as UsersCurrencies from '@models/users-currencies.model';
import { easternDate } from '@bt/shared/types/investment-market';

import { sqlRows } from './daily-account-cache';
import { connection } from '@models/connection';
import { getInvestmentAnalytics, visiblePortfolioSelection } from './service';

export const READ_MODEL_VERSION = 2;
const FRESH_MS = 60 * 60 * 1000;
const RETENTION_DAYS = 7;
const MAX_SELECTIONS = 48;
const MAX_REDIS_BYTES = 512 * 1024;
const CACHE_SECONDS = 90;
const projectionInFlight = new Map<string, Promise<InvestmentAnalyticsReadResponse>>();
let lastSnapshotCleanup = 0;

/** The range adapter changes only these top-level fields. Keep whole holdings
 * so unavailable values and per-account metadata survive exactly as before. */
export function investmentRangeOverlay(result: InvestmentAnalytics) {
  return { holdings: result.holdings, performanceTotals: result.performanceTotals };
}

/** Remove all unused fields from each operand before joining the overlay. */
export function analyticsProjectionSql(section: InvestmentAnalyticsSection) {
  const omitted = omittedAnalyticsFields(section);
  const project = (value: string, extra: string[] = []) => {
    const fields = [...new Set([...omitted, ...extra])];
    return fields.length ? `(${value} - ARRAY[${fields.map((field) => "'" + field + "'").join(',')}]::text[])` : value;
  };
  return `CASE WHEN m."rangeBaseKey" IS NULL THEN ${project('m.payload')}
    ELSE ${project('b.payload', ['holdings', 'performanceTotals'])} || ${project('m."rangeOverlay"')} END`;
}

interface Selection {
  portfolioIds: string[];
  benchmarkSymbols: string[];
  performanceFrom?: string;
  performanceThrough?: string;
  hiddenPortfolioIds: string[];
  currencyCode?: string;
}
type Request = Omit<Selection, 'hiddenPortfolioIds' | 'portfolioIds' | 'benchmarkSymbols' | 'currencyCode'> & {
  portfolioIds?: string[];
  benchmarkSymbols?: string[];
};

export function canonicalSelection(input: Selection): Selection {
  const unique = (values: string[]) => [...new Set(values)].sort();
  return {
    portfolioIds: unique(input.portfolioIds),
    benchmarkSymbols: unique(input.benchmarkSymbols),
    hiddenPortfolioIds: unique(input.hiddenPortfolioIds),
    currencyCode: input.currencyCode,
    performanceFrom: input.performanceFrom,
    performanceThrough: input.performanceThrough,
  };
}

export function selectionKey(selection: Selection): string {
  return createHash('sha256').update(JSON.stringify([READ_MODEL_VERSION, canonicalSelection(selection)])).digest('hex');
}

async function resolveSelection(userId: number, input: Request): Promise<Selection> {
  const [portfolios, settings, currency] = await Promise.all([
    Portfolios.findAll({ where: { userId }, attributes: ['id'] }),
    UserSettings.findOne({ where: { userId } }),
    UsersCurrencies.getCurrency({ userId, isDefaultCurrency: true }),
  ]);
  const hiddenPortfolioIds = settings?.settings.ui?.hiddenPortfolioIds ?? [];
  return canonicalSelection({
    ...input,
    portfolioIds: visiblePortfolioSelection(input.portfolioIds, portfolios.map((p) => p.id), hiddenPortfolioIds),
    hiddenPortfolioIds,
    currencyCode: currency?.currency.code ?? 'USD',
    benchmarkSymbols: input.benchmarkSymbols ?? [],
  });
}

interface StoredRow {
  userId: number;
  selectionKey: string;
  selection: Selection;
  payload: InvestmentAnalytics | null;
  builtAt: Date | string | null;
  failures: number;
  sourceRevision?: string | null;
}

export function readStatus(row: Pick<StoredRow, 'builtAt' | 'failures' | 'sourceRevision'>, now = Date.now(), revision?: string) {
  const builtAt = row.builtAt ? new Date(row.builtAt).toISOString() : null;
  const state = row.failures > 0 ? 'retrying' : !builtAt ? 'pending' :
    (revision !== undefined && row.sourceRevision !== revision) || now - Date.parse(builtAt) >= FRESH_MS ? 'stale' : 'ready';
  return { state, builtAt } as const;
}

async function sourceRevision(): Promise<string> {
  const [row] = await sqlRows<{ revision: string }>(`
    SELECT COALESCE(string_agg(source || ':' || revision::text, ',' ORDER BY source), '') AS revision
    FROM "InvestmentAnalyticsSourceRevisions"
  `);
  return easternDate() + ':' + (row?.revision ?? '');
}
export function projectionCacheKey(userId: number, key: string, section: InvestmentAnalyticsSection, builtAt: string) {
  return `investment-projection:v2:${userId}:${key}:${section}:${builtAt}`;
}

/** A GET only registers demand and reads the durable result. No financial replay on the request path. */
export async function readInvestmentAnalytics({
  userId, section = 'all', knownBuiltAt, ...input
}: Request & { userId: number; section?: InvestmentAnalyticsSection; knownBuiltAt?: string }): Promise<InvestmentAnalyticsReadResponse> {
  const selection = await resolveSelection(userId, input);
  const key = selectionKey(selection);
  // Serialize admission per owner using the Users row. Prevent unbounded date-range variants.
  // The single SQL statement uses an owner-specific advisory transaction lock.
  const [row] = await sqlRows<StoredRow>(`
    WITH gate AS MATERIALIZED (SELECT pg_advisory_xact_lock(17428819, :userId)),
    admitted AS (
      INSERT INTO "InvestmentAnalyticsReadModels" ("userId", "selectionKey", selection)
      SELECT :userId, :key, CAST(:selection AS jsonb) FROM gate
      WHERE EXISTS (SELECT 1 FROM "InvestmentAnalyticsReadModels" WHERE "userId"=:userId AND "selectionKey"=:key)
         OR (SELECT count(*) FROM "InvestmentAnalyticsReadModels" WHERE "userId"=:userId) < :maxSelections
      ON CONFLICT ("userId", "selectionKey") DO UPDATE SET "requestedAt"=now()
      RETURNING "userId", "selectionKey", "builtAt", failures, "sourceRevision", NULL::jsonb AS payload
    ) SELECT * FROM admitted
  `, { userId, key, selection: JSON.stringify(selection), maxSelections: MAX_SELECTIONS });
  if (!row) throw new ValidationError({ message: 'Too many investment analytics selections. Reuse an existing range or try again after cleanup.' });
  const revision = await sourceRevision();
  const status = readStatus(row, Date.now(), revision);
  if (!status.builtAt) return { analytics: null, status };
  if (knownBuiltAt === status.builtAt) return { analytics: null, status, unchanged: true };
  const cacheKey = projectionCacheKey(userId, key, section, status.builtAt);
  try {
    const hit = await redisClient.get(cacheKey);
    if (hit) return { analytics: JSON.parse(hit) as InvestmentAnalytics, status };
  } catch { /* PostgreSQL remains authoritative if Redis is unavailable. */ }
  const flightKey = JSON.stringify([cacheKey, revision]);
  const existing = projectionInFlight.get(flightKey);
  if (existing) return existing;
  const work = (async (): Promise<InvestmentAnalyticsReadResponse> => {
    // Project base and overlay independently before transferring the result.
    const expression = analyticsProjectionSql(section);
    const [stored] = await sqlRows<StoredRow>(`
      SELECT m."builtAt", m.failures, m."sourceRevision", ${expression} AS payload
      FROM "InvestmentAnalyticsReadModels" m
      LEFT JOIN "InvestmentAnalyticsRangeBases" b ON b."userId"=m."userId"
        AND b."baseKey"=m."rangeBaseKey" AND b."baseBuiltAt"=m."rangeBaseBuiltAt"
      WHERE m."userId"=:userId AND m."selectionKey"=:key
    `, { userId, key });
    if (!stored) return { analytics: null, status: { state: 'pending', builtAt: null } };
    const analytics = stored.payload ? projectInvestmentAnalytics(stored.payload, section) : null;
    const actualStatus = readStatus(stored, Date.now(), revision);
    if (analytics && actualStatus.builtAt === status.builtAt && section !== 'all') {
      const json = JSON.stringify(analytics);
      if (Buffer.byteLength(json) <= MAX_REDIS_BYTES) {
        try { await redisClient.set(cacheKey, json, 'EX', CACHE_SECONDS); } catch { /* durable fallback */ }
      }
    }
    return { analytics, status: actualStatus };
  })();
  projectionInFlight.set(flightKey, work);
  try { return await work; } finally {
    if (projectionInFlight.get(flightKey) === work) projectionInFlight.delete(flightKey);
  }
}

/** Called by the scheduler, never the request handler. One selection per run. */
export async function refreshNextInvestmentReadModel(): Promise<boolean> {
  await sqlRows(`
    DELETE FROM "InvestmentAnalyticsReadModels"
    WHERE "requestedAt" < now() - make_interval(days => :days)
       OR NOT (selection ? 'currencyCode')
    RETURNING "selectionKey"
  `, { days: RETENTION_DAYS });
  if (Date.now() - lastSnapshotCleanup >= 10 * 60 * 1000) {
    await sqlRows(`
      DELETE FROM "InvestmentAnalyticsRangeBases" b
      WHERE NOT EXISTS (SELECT 1 FROM "InvestmentAnalyticsReadModels" m
        WHERE m."userId"=b."userId" AND m."rangeBaseKey"=b."baseKey"
          AND m."rangeBaseBuiltAt"=b."baseBuiltAt")
      RETURNING "baseKey"
    `);
    lastSnapshotCleanup = Date.now();
  }
  const revision = await sourceRevision();
  const [row] = await sqlRows<StoredRow>(`
    SELECT "userId", "selectionKey", selection, "builtAt", failures, "sourceRevision", NULL::jsonb AS payload
    FROM "InvestmentAnalyticsReadModels"
    WHERE "retryAt" <= now()
      AND "requestedAt" >= now() - interval '10 minutes'
      AND ("builtAt" IS NULL OR ("sourceRevision" IS DISTINCT FROM :revision AND "builtAt" <= now() - interval '90 seconds') OR "builtAt" <= now() - interval '60 minutes')
    ORDER BY ("builtAt" IS NOT NULL),
      (selection ? 'performanceFrom'), "retryAt", "requestedAt" DESC LIMIT 1
  `, { revision });
  if (!row) return false;
  try {
    // Recheck live ownership/visibility before publication. Deleted or hidden portfolios
    // never leak via an old read-model key.
    const before = await resolveSelection(row.userId, row.selection);
    if (selectionKey(before) !== row.selectionKey) {
      await sqlRows('DELETE FROM "InvestmentAnalyticsReadModels" WHERE "userId"=:userId AND "selectionKey"=:key RETURNING "selectionKey"', { userId: row.userId, key: row.selectionKey });
      return true;
    }
    let rangeBase: InvestmentAnalytics | undefined;
    let rangeReference: { key: string; builtAt: string } | undefined;
    if (before.performanceFrom && before.performanceThrough) {
      const baseKey = selectionKey({ ...before, performanceFrom: undefined, performanceThrough: undefined });
      const [base] = await sqlRows<{ payload: InvestmentAnalytics | null; exactBuiltAt: string }>(`
        SELECT payload, "builtAt"::text AS "exactBuiltAt" FROM "InvestmentAnalyticsReadModels"
        WHERE "userId"=:userId AND "selectionKey"=:baseKey AND "sourceRevision"=:revision
          AND "builtAt" IS NOT NULL AND failures=0 AND payload IS NOT NULL
      `, { userId: row.userId, baseKey, revision });
      rangeBase = base?.payload ?? undefined;
      if (rangeBase && base) rangeReference = { key: baseKey, builtAt: base.exactBuiltAt };
    }
    const result = await getInvestmentAnalytics({
      userId: row.userId,
      portfolioIds: before.portfolioIds,
      benchmarkSymbols: before.benchmarkSymbols,
      performanceFrom: before.performanceFrom,
      performanceThrough: before.performanceThrough,
      compact: true,
      rangeBase,
      priceRevision: revision,
    });
    const after = await resolveSelection(row.userId, row.selection);
    if (selectionKey(after) !== row.selectionKey) return true;
    // Never publish a range overlay assembled across two source revisions.
    if (rangeBase && await sourceRevision() !== revision) return true;
    const serializeStart = Date.now();
    const payload = JSON.stringify(rangeReference ? investmentRangeOverlay(result) : result);
    const serializationMs = Date.now() - serializeStart;
    const persistStart = Date.now();
    const params = { userId: row.userId, key: row.selectionKey, payload, revision };
    if (rangeReference) {
      // Copy a particular base version only once, inside the same transaction
      // that publishes its dependent range. Never join a newer base to old gains.
      const reference = { ...params, baseKey: rangeReference.key, baseBuiltAt: rangeReference.builtAt };
      await connection.sequelize.transaction(async () => {
        await sqlRows(`
          INSERT INTO "InvestmentAnalyticsRangeBases" ("userId", "baseKey", "baseBuiltAt", payload)
          SELECT "userId", "selectionKey", "builtAt", payload FROM "InvestmentAnalyticsReadModels"
          WHERE "userId"=:userId AND "selectionKey"=:baseKey AND "builtAt"=CAST(:baseBuiltAt AS timestamptz)
            AND "sourceRevision"=:revision AND payload IS NOT NULL
          ON CONFLICT DO NOTHING RETURNING "baseKey"
        `, reference);
        const published = await sqlRows(`
          UPDATE "InvestmentAnalyticsReadModels" m
          SET payload=NULL, "rangeOverlay"=CAST(:payload AS jsonb), "rangeBaseKey"=b."baseKey", "rangeBaseBuiltAt"=b."baseBuiltAt",
            "sourceRevision"=:revision, "builtAt"=now(), "retryAt"=now()+interval '90 seconds', failures=0
          FROM "InvestmentAnalyticsRangeBases" b
          WHERE m."userId"=:userId AND m."selectionKey"=:key AND b."userId"=m."userId"
            AND b."baseKey"=:baseKey AND b."baseBuiltAt"=CAST(:baseBuiltAt AS timestamptz)
          RETURNING m."selectionKey"
        `, reference);
        if (!published.length) throw new Error('Investment range base disappeared before publication');
      });
    } else {
      await sqlRows(`
        UPDATE "InvestmentAnalyticsReadModels"
        SET payload=CAST(:payload AS jsonb), "rangeOverlay"=NULL, "rangeBaseKey"=NULL, "rangeBaseBuiltAt"=NULL,
          "sourceRevision"=:revision, "builtAt"=now(), "retryAt"=now()+interval '90 seconds', failures=0
        WHERE "userId"=:userId AND "selectionKey"=:key RETURNING "selectionKey"
      `, params);
    }
    logger.info('Investment analytics read-model publication', {
      payloadBytes: Buffer.byteLength(payload),
      storageMode: rangeReference ? 'range-overlay' : 'full',
      serializationMs,
      persistenceMs: Date.now() - persistStart,
      reusedBase: Boolean(rangeBase),
      customRange: Boolean(before.performanceFrom && before.performanceThrough),
    });
    return true;
  } catch (error) {
    // Retain the last valid payload and retry with bounded backoff.
    await sqlRows(`
      UPDATE "InvestmentAnalyticsReadModels"
      SET failures=failures+1, "retryAt"=now()+make_interval(secs => LEAST(900, 15 * (failures+1)))
      WHERE "userId"=:userId AND "selectionKey"=:key RETURNING "selectionKey"
    `, { userId: row.userId, key: row.selectionKey });
    logger.warn('Investment analytics read-model refresh failed; previous result retained.', {
      selectionKey: row.selectionKey,
      failures: row.failures + 1,
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    return true;
  }
}
