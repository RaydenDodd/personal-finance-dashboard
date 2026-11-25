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

import { sqlRows } from './daily-account-cache';
import { getInvestmentAnalytics, visiblePortfolioSelection } from './service';

export const READ_MODEL_VERSION = 1;
const FRESH_MS = 5 * 60 * 1000;
const RETENTION_DAYS = 7;
const MAX_SELECTIONS = 24;

interface Selection {
  portfolioIds: string[];
  benchmarkSymbols: string[];
  performanceFrom?: string;
  performanceThrough?: string;
  hiddenPortfolioIds: string[];
}
type Request = Omit<Selection, 'hiddenPortfolioIds' | 'portfolioIds' | 'benchmarkSymbols'> & {
  portfolioIds?: string[];
  benchmarkSymbols?: string[];
};

export function canonicalSelection(input: Selection): Selection {
  const unique = (values: string[]) => [...new Set(values)].sort();
  return {
    portfolioIds: unique(input.portfolioIds),
    benchmarkSymbols: unique(input.benchmarkSymbols),
    hiddenPortfolioIds: unique(input.hiddenPortfolioIds),
    performanceFrom: input.performanceFrom,
    performanceThrough: input.performanceThrough,
  };
}

export function selectionKey(selection: Selection): string {
  return createHash('sha256').update(JSON.stringify([READ_MODEL_VERSION, canonicalSelection(selection)])).digest('hex');
}

async function resolveSelection(userId: number, input: Request): Promise<Selection> {
  const [portfolios, settings] = await Promise.all([
    Portfolios.findAll({ where: { userId }, attributes: ['id'] }),
    UserSettings.findOne({ where: { userId } }),
  ]);
  const hiddenPortfolioIds = settings?.settings.ui?.hiddenPortfolioIds ?? [];
  return canonicalSelection({
    ...input,
    portfolioIds: visiblePortfolioSelection(input.portfolioIds, portfolios.map((p) => p.id), hiddenPortfolioIds),
    hiddenPortfolioIds,
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
}

export function readStatus(row: Pick<StoredRow, 'builtAt' | 'failures'>, now = Date.now()) {
  const builtAt = row.builtAt ? new Date(row.builtAt).toISOString() : null;
  const state = row.failures > 0 ? 'retrying' : !builtAt ? 'pending' :
    now - Date.parse(builtAt) >= FRESH_MS ? 'stale' : 'ready';
  return { state, builtAt } as const;
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
      RETURNING "userId", "selectionKey", "builtAt", failures, NULL::jsonb AS payload
    ) SELECT * FROM admitted
  `, { userId, key, selection: JSON.stringify(selection), maxSelections: MAX_SELECTIONS });
  if (!row) throw new ValidationError({ message: 'Too many investment analytics selections. Reuse an existing range or try again after cleanup.' });
  const status = readStatus(row);
  if (!status.builtAt) return { analytics: null, status };
  if (knownBuiltAt === status.builtAt) return { analytics: null, status, unchanged: true };
  const omitted = omittedAnalyticsFields(section);
  // SQL projection happens before network transfer and JSON parsing in Node.
  // The names are a fixed server-side allowlist, not request-provided SQL.
  const expression = omitted.reduce((sql, field) => sql + " - '" + field + "'", 'payload');
  const [stored] = await sqlRows<StoredRow>(`
    SELECT "builtAt", failures, ${expression} AS payload
    FROM "InvestmentAnalyticsReadModels"
    WHERE "userId"=:userId AND "selectionKey"=:key
  `, { userId, key });
  if (!stored) return { analytics: null, status: { state: 'pending', builtAt: null } };
  return {
    analytics: stored.payload ? projectInvestmentAnalytics(stored.payload, section) : null,
    status: readStatus(stored),
  };
}

/** Called by the scheduler, never the request handler. One selection per run. */
export async function refreshNextInvestmentReadModel(): Promise<boolean> {
  await sqlRows(`
    DELETE FROM "InvestmentAnalyticsReadModels"
    WHERE "requestedAt" < now() - make_interval(days => :days)
    RETURNING "selectionKey"
  `, { days: RETENTION_DAYS });
  const [row] = await sqlRows<StoredRow>(`
    SELECT "userId", "selectionKey", selection, "builtAt", failures, NULL::jsonb AS payload
    FROM "InvestmentAnalyticsReadModels"
    WHERE "retryAt" <= now()
      AND "requestedAt" >= now() - interval '10 minutes'
      AND ("builtAt" IS NULL OR "builtAt" <= now() - interval '5 minutes')
    ORDER BY ("builtAt" IS NOT NULL), "retryAt", "requestedAt" DESC LIMIT 1
  `);
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
      SET payload=CAST(:payload AS jsonb), "builtAt"=now(), "retryAt"=now()+interval '5 minutes', failures=0
      WHERE "userId"=:userId AND "selectionKey"=:key RETURNING "selectionKey"
    `, { userId: row.userId, key: row.selectionKey, payload: JSON.stringify(result) });
    return true;
  } catch {
    // Retain the last valid payload and retry with bounded backoff.
    await sqlRows(`
      UPDATE "InvestmentAnalyticsReadModels"
      SET failures=failures+1, "retryAt"=now()+make_interval(secs => LEAST(900, 15 * (failures+1)))
      WHERE "userId"=:userId AND "selectionKey"=:key RETURNING "selectionKey"
    `, { userId: row.userId, key: row.selectionKey });
    logger.warn('Investment analytics read-model refresh failed; previous result retained.');
    return true;
  }
}
