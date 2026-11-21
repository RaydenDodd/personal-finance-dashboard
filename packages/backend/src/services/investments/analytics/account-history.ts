import type { InvestmentAccountHistoryResponse } from "@bt/shared/types/investment-history";
import {
  easternDate,
  investmentPriceDate,
} from "@bt/shared/types/investment-market";
import { investmentHistoryCron } from "@crons/investment-history";
import { ValidationError } from "@js/errors";
import Portfolios from "@models/investments/portfolios.model";
import UserSettings from "@models/user-settings.model";
import * as UsersCurrencies from "@models/users-currencies.model";
import Big from "big.js";
import { accountGainSeries, sumGainSeries } from "./account-history-gains";

import { sqlRows, ACCOUNT_HISTORY_VERSION } from "./daily-account-cache";

const decimal = (v: string | null) =>
  v === null ? null : new Big(v).toString();
export async function getAccountHistory({
  userId,
  portfolioIds,
  from,
  through,
  includeCapital = false,
  gainFrom,
  includeEvents = false,
  audit = false,
  coverageOnly = false,
}: {
  userId: number;
  portfolioIds?: string[];
  from?: string;
  through?: string;
  includeCapital?: boolean;
  gainFrom?: string;
  includeEvents?: boolean;
  audit?: boolean;
  coverageOnly?: boolean;
}): Promise<InvestmentAccountHistoryResponse> {
  const [owned, settings, currency] = await Promise.all([
    Portfolios.findAll({ where: { userId }, order: [["name", "ASC"]] }),
    UserSettings.findOne({ where: { userId } }),
    UsersCurrencies.getCurrency({ userId, isDefaultCurrency: true }),
  ]);
  if (portfolioIds?.some((id) => !owned.some((p) => p.id === id)))
    throw new ValidationError({
      message: "Selected portfolio is unavailable.",
    });
  if (from && through && from > through)
    throw new ValidationError({
      message: "Choose a start date on or before the end date.",
    });
  const hidden = settings?.settings.ui?.hiddenPortfolioIds ?? [];
  const scope = owned.filter(
    (p) =>
      !hidden.includes(p.id) &&
      (!portfolioIds?.length || portfolioIds.includes(p.id)),
  );
  const ids = scope.map((p) => String(p.id)),
    currencyCode = currency?.currency.code ?? "USD",
    today = easternDate();
  const result: InvestmentAccountHistoryResponse = {
    generatedAt: new Date().toISOString(),
    currencyCode,
    dates: [],
    total: [],
    accountsKnown: [],
    accountsFull: [],
    accounts: [],
    pending: false,
  };
  if (!ids.length) return result;
  await sqlRows(
    `INSERT INTO "InvestmentHistoryDirty"("portfolioId","fromDate")
    SELECT p.id,CASE WHEN s."currencyCode"<>:currency OR COALESCE((s.audit->>'version')::int,0)<>:version THEN COALESCE(s."firstDate",'1900-01-01') ELSE COALESCE(s."lastDate"+1,'1900-01-01') END FROM "Portfolios" p LEFT JOIN "InvestmentHistoryState" s ON s."portfolioId"=p.id
    WHERE p.id IN (:ids) AND (s."portfolioId" IS NULL OR s."lastDate"<CAST(:today AS date) OR s."currencyCode"<>:currency OR COALESCE((s.audit->>'version')::int,0)<>:version) ON CONFLICT("portfolioId") DO NOTHING RETURNING "portfolioId"`,
    { ids, currency: currencyCode, today, version: ACCOUNT_HISTORY_VERSION },
  );
  const meta = await sqlRows<{
    id: string;
    broker: string | null;
    firstDate: string | null;
    lastDate: string | null;
    builtAt: string | null;
    audit: Record<string, unknown> | null;
    pending: boolean;
  }>(
    `
    SELECT p.id,b.data->>'broker' AS broker,s."firstDate",s."lastDate",s."builtAt",${audit ? "s.audit" : `jsonb_build_object('firstPurchase',s.audit->'firstPurchase','needs',s.audit->'needs')`} AS audit,q."portfolioId" IS NOT NULL AS pending
    FROM "Portfolios" p LEFT JOIN "BrokerPortfolioData" b ON b."portfolioId"=p.id LEFT JOIN "InvestmentHistoryState" s ON s."portfolioId"=p.id LEFT JOIN "InvestmentHistoryDirty" q ON q."portfolioId"=p.id WHERE p.id IN (:ids)`,
    { ids },
  );
  const params = {
    ids,
    currency: currencyCode,
    from: from ?? "0001-01-01",
    through: through && through < today ? through : today,
  };
  const rows = coverageOnly
    ? []
    : await sqlRows<{
        portfolioId: string;
        date: string;
        value: string | null;
        knownValue: string | null;
        netFunding: string | null;
        coverage: {
          priced?: number;
          missing?: number;
          unknown?: number;
          cash?: boolean;
        };
      }>(
        `
    SELECT "portfolioId",date,value,"knownValue","netFunding",coverage FROM "InvestmentDailyAccountValues" WHERE "portfolioId" IN (:ids) AND "currencyCode"=:currency AND date BETWEEN CAST(:from AS date) AND CAST(:through AS date) ORDER BY date`,
        params,
      );
  const totals = coverageOnly
    ? []
    : await sqlRows<{
        date: string;
        total: string | null;
        known: string;
        full: string;
        funding?: string | null;
        priced: string;
        missing: string;
        unknown: string;
      }>(
        `
    SELECT date,SUM("knownValue") AS total,COUNT("knownValue") AS known,COUNT(value) AS full,SUM(COALESCE((coverage->>'priced')::int,0)) AS priced,SUM(COALESCE((coverage->>'missing')::int,0)) AS missing,SUM(COALESCE((coverage->>'unknown')::int,0)) AS unknown${includeCapital ? ',SUM("netFunding") AS funding' : ""} FROM "InvestmentDailyAccountValues"
    WHERE "portfolioId" IN (:ids) AND "currencyCode"=:currency AND date BETWEEN CAST(:from AS date) AND CAST(:through AS date) GROUP BY date ORDER BY date`,
        params,
      );
  result.dates = totals.map((r) => r.date);
  result.total = totals.map((r) => decimal(r.total));
  result.accountsKnown = totals.map((r) => Number(r.known));
  result.accountsFull = totals.map((r) => Number(r.full));
  result.positionsPriced = totals.map((r) => Number(r.priced));
  result.positionsMissing = totals.map((r) => Number(r.missing));
  result.quantitiesUnknown = totals.map((r) => Number(r.unknown));
  if (includeCapital)
    result.netFunding = totals.map((r) => decimal(r.funding ?? null));
  const byAccount = new Map<string, Map<string, (typeof rows)[number]>>();
  for (const r of rows) {
    const map = byAccount.get(r.portfolioId) ?? new Map();
    map.set(r.date, r);
    byAccount.set(r.portfolioId, map);
  }
  result.accounts = scope.map((p) => {
    const m = meta.find((r) => r.id === p.id),
      map = byAccount.get(p.id);
    const gainSeries = includeCapital
      ? accountGainSeries(
          result.dates.map((date) => ({
            date,
            value: map?.get(date)?.knownValue ?? null,
            funding: map?.get(date)?.netFunding ?? null,
          })),
          gainFrom,
        )
      : undefined;
    return {
      ...(gainSeries && {
        gains: gainSeries.gains,
        periodGains: gainSeries.periodGains,
      }),
      id: p.id,
      name: p.name,
      broker: m?.broker ?? "Other",
      accountType: /\broth\b/i.test(p.name)
        ? "Roth"
        : /\b(traditional|rollover)\b/i.test(p.name)
          ? "Traditional retirement"
          : p.portfolioType,
      isEnabled: p.isEnabled,
      firstPurchase: (m?.audit?.firstPurchase as string | null) ?? null,
      firstDate: m?.firstDate ?? null,
      lastDate: m?.lastDate ?? null,
      builtAt: m?.builtAt ?? null,
      pending: m?.pending ?? true,
      values: result.dates.map((d) => decimal(map?.get(d)?.knownValue ?? null)),
      full: result.dates.map((d) => map?.get(d)?.value != null),
      coverage: result.dates.map((d) => {
        const c = map?.get(d)?.coverage;
        return [
          c?.priced ?? 0,
          c?.missing ?? 0,
          c?.unknown ?? 0,
          c?.cash ?? false,
        ];
      }),
      ...(audit && {
        audit: m?.audit ?? { needs: ["History reconstruction is queued."] },
      }),
    };
  });
  if (includeCapital) {
    result.gains = sumGainSeries(
      result.accounts.map((a) => a.gains ?? []),
      result.dates.length,
    );
    result.periodGains = sumGainSeries(
      result.accounts.map((a) => a.periodGains ?? []),
      result.dates.length,
    );
    result.gainFrom = gainFrom;
  }
  result.pending = result.accounts.some((p) => p.pending);
  if (result.pending)
    void investmentHistoryCron
      .triggerManualSync({ userId })
      .catch(() => undefined);
  if (includeEvents) {
    const events = await sqlRows<{
      id: string;
      date: string;
      category: string;
      refAmount: string;
      portfolioId: string;
      symbol: string | null;
    }>(
      `SELECT t.id,t.date,t.category,t."refAmount",t."portfolioId",s.symbol FROM "InvestmentTransactions" t LEFT JOIN "Securities" s ON s.id=t."securityId" WHERE t."portfolioId" IN (:ids) AND t.date>=CAST(:from AS date) AND t.date<CAST(:through AS date)+INTERVAL '1 day' ORDER BY t.date`,
      params,
    );
    result.events = events.map((e) => ({
      id: e.id,
      date: investmentPriceDate(e.date),
      type: e.category,
      label: [e.symbol, e.category].filter(Boolean).join(" "),
      amount: decimal(e.refAmount)!,
      portfolioId: e.portfolioId,
    }));
  }
  return result;
}
