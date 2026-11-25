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
import { getInvestmentAnalytics, visiblePortfolioSelection } from './service';

export const READ_MODEL_VERSION = 2;
const FRESH_MS = 60 * 60 * 1000;
const RETENTION_DAYS = 7;
const MAX_SELECTIONS = 48;
const MAX_REDIS_BYTES = 512 * 1024;
const CACHE_SECONDS = 90;

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
  const omitted = omittedAnalyticsFields(section);
  // SQL projection happens before network transfer and JSON parsing in Node.
  // The names are a fixed server-side allowlist, not request-provided SQL.
  const expression = omitted.reduce((sql, field) => sql + " - '" + field + "'", 'payload');
  const [stored] = await sqlRows<StoredRow>(`
    SELECT "builtAt", failures, "sourceRevision", ${expression} AS payload
    FROM "InvestmentAnalyticsReadModels"
    WHERE "userId"=:userId AND "selectionKey"=:key
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
}

/** Called by the scheduler, never the request handler. One selection per run. */
export async function refreshNextInvestmentReadModel(): Promise<boolean> {
  await sqlRows(`
    DELETE FROM "InvestmentAnalyticsReadModels"
    WHERE "requestedAt" < now() - make_interval(days => :days)
       OR NOT (selection ? 'currencyCode')
    RETURNING "selectionKey"
  `, { days: RETENTION_DAYS });
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
    const result = await getInvestmentAnalytics({
      userId: row.userId,
      portfolioIds: before.portfolioIds,
      benchmarkSymbols: before.benchmarkSymbols,
      performanceFrom: before.performanceFrom,
      performanceThrough: before.performanceThrough,
      compact: true,
    });
    const after = await resolveSelection(row.userId, row.selection);
    if (selectionKey(after) !== row.selectionKey) return true;
    await sqlRows(`
      UPDATE "InvestmentAnalyticsReadModels"
      SET payload=CAST(:payload AS jsonb), "sourceRevision"=:revision, "builtAt"=now(), "retryAt"=now()+interval '90 seconds', failures=0
      WHERE "userId"=:userId AND "selectionKey"=:key RETURNING "selectionKey"
    `, { userId: row.userId, key: row.selectionKey, payload: JSON.stringify(result), revision });
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
