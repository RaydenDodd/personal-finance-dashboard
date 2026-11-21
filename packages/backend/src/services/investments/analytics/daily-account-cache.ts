import { easternDate, investmentPriceDate, usEquityObservationAllowed } from '@bt/shared/types/investment-market';
import { connection } from '@models/connection';
import BrokerPortfolioData from '@models/investments/broker-portfolio-data.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import type { SecurityPriceRow } from '@services/stats/get-combined-balance-history/security-price-lookup';
import type { TransactionRow } from '@services/stats/get-combined-balance-history/types';
import { QueryTypes, Op, type Transaction } from 'sequelize';

import { usesUsEquitySession } from '../securities-price/regular-session';
import { buildHistory } from './history';
import { sourceQuantityEvidence } from './source-quantity-evidence';
export const ACCOUNT_HISTORY_VERSION = 3;

export const sqlRows = <T extends object>(sql: string, replacements: Record<string, unknown> = {}) =>
  connection.sequelize.query(sql, { replacements, type: QueryTypes.SELECT }) as Promise<T[]>;
const nextDay = (date: string, days = 1) => {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** One account/year chunk at a time. The source records are read-only; only derived tables are written. */
export async function refreshNextAccountHistory(userId?: number) {
  const [work] = await sqlRows<{
    portfolioId: string;
    fromDate: string;
    revision: string;
    nextDate: string | null;
    pendingRevision: string | null;
    currencyCode: string | null;
    audit: Record<string, unknown> | null;
  }>(
    `
    SELECT q.*,s."nextDate",s."pendingRevision",s."currencyCode",s.audit
    FROM "InvestmentHistoryDirty" q JOIN "Portfolios" p ON p.id=q."portfolioId"
    LEFT JOIN "InvestmentHistoryState" s ON s."portfolioId"=q."portfolioId"
    LEFT JOIN "UserSettings" u ON u."userId"=p."userId"
    WHERE (:userId IS NULL OR p."userId"=:userId)
    AND NOT jsonb_exists(COALESCE(u.settings->'ui'->'hiddenPortfolioIds','[]'::jsonb),p.id::text)
    ORDER BY s."builtAt" NULLS FIRST,q."portfolioId" LIMIT 1`,
    { userId: userId ?? null },
  );
  if (!work) return false;
  const portfolio = await Portfolios.findByPk(work.portfolioId);
  if (!portfolio) return false;
  const currency =
    (await UsersCurrencies.getCurrency({ userId: portfolio.userId, isDefaultCurrency: true }))?.currency.code ?? 'USD';
  const [broker, transactions, transfers, balances] = await Promise.all([
    BrokerPortfolioData.findByPk(portfolio.id),
    InvestmentTransaction.findAll({
      where: { portfolioId: portfolio.id },
      attributes: [
        'securityId',
        'portfolioId',
        'date',
        'category',
        ['name', 'description'],
        'transactionType',
        'quantity',
        'refAmount',
        'currencyCode',
        'settlementAmount',
        'settlementCurrencyCode',
      ],
      order: [
        ['date', 'ASC'],
        ['createdAt', 'ASC'],
      ],
      raw: true,
    }) as unknown as Promise<TransactionRow[]>,
    PortfolioTransfers.findAll({
      where: { [Op.or]: [{ fromPortfolioId: portfolio.id }, { toPortfolioId: portfolio.id }] },
    }),
    PortfolioBalances.findAll({ where: { portfolioId: portfolio.id } }),
  ]);
  const snapshots = broker?.data.snapshots ?? [];
  const nativeIds = [
    ...new Set([
      ...transactions.map((t) => t.securityId),
      ...snapshots.flatMap((s) => s.positions.map((p) => p.securityId)),
    ]),
  ];
  const sourceSymbols = [
    ...new Set(
      (broker?.data.sourceEvents ?? [])
        .filter((e) => ['REC', 'SXCH', 'SPR', 'Buy', 'Sell'].includes(String(e.action)))
        .map((e) => String(e.symbol ?? '')),
    ),
  ];
  const securities = await Securities.findAll({
    where: { [Op.or]: [{ id: { [Op.in]: nativeIds } }, { symbol: { [Op.in]: sourceSymbols } }] },
  });
  const sourceEvidence = broker
    ? sourceQuantityEvidence(portfolio.id, broker.data, securities, transactions)
    : { rows: [], issues: [] };
  const evidenceDates = [
    ...transactions.map((t) => investmentPriceDate(t.date)),
    ...sourceEvidence.rows.map((t) => investmentPriceDate(t.date)),
    ...sourceEvidence.issues.map((e) => e.date),
    ...transfers.map((t) => t.date),
    ...snapshots.map((s) => investmentPriceDate(s.asOf)),
  ].sort();
  const first = evidenceDates[0] ?? easternDate(),
    today = easternDate();
  const continuing =
    work.audit?.version === ACCOUNT_HISTORY_VERSION &&
    String(work.pendingRevision) === String(work.revision) &&
    work.currencyCode === currency &&
    work.nextDate;
  const from = continuing
    ? work.nextDate!
    : work.currencyCode && work.currencyCode !== currency
      ? first
      : work.fromDate > first
        ? work.fromDate
        : first;
  const through = nextDay(from, 365) < today ? nextDay(from, 365) : today;
  const ids = [
    ...new Set([
      ...transactions.map((t) => t.securityId),
      ...sourceEvidence.rows.map((t) => t.securityId),
      ...snapshots.flatMap((s) => s.positions.map((p) => p.securityId)),
    ]),
  ];
  // Daily records, plus today's real regular quotes. Do not hydrate Money objects or load fund/source documents.
  const rows = ids.length
    ? await sqlRows<SecurityPriceRow & { previousClose: unknown }>(
        `
    SELECT "securityId",date,"priceClose","unadjustedClose",source,"priceAsOf","previousClose"
    FROM "SecurityPricings" WHERE "securityId" IN (:ids) AND date<=now() AND ("priceAsOf" IS NULL OR "priceAsOf"<=now())
    AND ("priceAsOf" IS NULL OR date=date_trunc('day',date AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' OR date>=CAST(:today AS date) OR ("previousClose" IS NOT NULL AND date>=CAST(:today AS date)-INTERVAL '7 days'))
    ORDER BY date`,
        { ids, today },
      )
    : [];
  const usIds = new Set(securities.filter(usesUsEquitySession).map((s) => String(s.id)));
  const prices = rows.filter(
    (p) =>
      p.source !== 'yahoo' ||
      !p.priceAsOf ||
      p.previousClose ||
      !usIds.has(p.securityId) ||
      usEquityObservationAllowed(p.priceAsOf),
  );
  const coverage = new Map<string, object>();
  const previousAudit = continuing
    ? (work.audit ?? {})
    : {
        ...work.audit,
        missing: ((work.audit?.missing ?? []) as { from: string; through: string }[])
          .filter((r) => r.from < from)
          .map((r) => ({ ...r, through: r.through < from ? r.through : nextDay(from, -1) })),
        samples: ((work.audit?.samples ?? []) as { date: string }[]).filter((r) => r.date < from),
        reconciliations: ((work.audit?.reconciliations ?? []) as { date: string }[]).filter((r) => r.date < from),
      };
  const missing = (
    (previousAudit.missing as { securityId: string; from: string; through: string; kind: string }[]) ?? []
  ).map((r) => ({ ...r }));
  const lastMissing = new Map(missing.map((r) => [r.kind + ':' + r.securityId, r]));
  const samples = ((previousAudit.samples as object[]) ?? []).slice(0, 120);
  const reconciliations = new Map<string, object>(
    ((previousAudit.reconciliations ?? []) as { date: string; securityId: string }[]).map((r) => [
      r.date + ':' + r.securityId,
      r,
    ]),
  );
  const firstBuy = new Map<string, string>();
  const valuationTrades = [...transactions, ...sourceEvidence.rows].sort((a, b) => +a.date - +b.date);
  for (const t of valuationTrades)
    if (t.category === 'buy' && !firstBuy.has(t.securityId)) firstBuy.set(t.securityId, investmentPriceDate(t.date));
  const saleDays = new Set(
    valuationTrades.filter((t) => t.category === 'sell').map((t) => nextDay(investmentPriceDate(t.date), -1)),
  );
  const history = buildHistory({
    ids: [portfolio.id],
    currencyCode: currency,
    brokers: broker ? [broker] : [],
    transactions,
    transfers,
    balances,
    securities,
    prices,
    from,
    through,
    onAnchorDifference: (r) => {
      if (r.date >= from && reconciliations.size < 300) reconciliations.set(r.date + ':' + r.securityId, r);
    },
    onCoverage: (r) => {
      coverage.set(r.date, {
        priced: r.priced,
        missing: r.missingPrices.length,
        unknown: r.unknownQuantities.length,
        cash: r.cashKnown,
        fx: r.fxMissing,
      });
      for (const [kind, list] of [
        ['price', r.missingPrices],
        ['quantity', r.unknownQuantities],
      ] as const)
        for (const securityId of list) {
          const key = kind + ':' + securityId,
            old = lastMissing.get(key);
          if (old && nextDay(old.through) === r.date) old.through = r.date;
          else if (!old || old.through !== r.date) {
            const run = { securityId, kind, from: r.date, through: r.date };
            missing.push(run);
            lastMissing.set(key, run);
          }
        }
    },
    onHoldingValue: (r) => {
      if (samples.length < 120 && (firstBuy.get(r.securityId) === r.date || saleDays.has(r.date)))
        samples.push({
          securityId: r.securityId,
          date: r.date,
          quantityInCurrentShareUnits: r.quantity,
          priceInCurrentShareUnits: r.value / r.quantity,
          value: r.value,
        });
    },
  });
  const audit = {
    version: ACCOUNT_HISTORY_VERSION,
    firstPurchase: [...firstBuy.values()].sort()[0] ?? null,
    firstRecord: first,
    lastSnapshot: snapshots.at(-1)?.asOf ?? null,
    missing,
    samples,
    reconciliations: [...reconciliations.values()],
    securities: securities.map((s) => ({ id: s.id, symbol: s.symbol ?? s.providerSymbol })),
    needs: [
      ...sourceEvidence.issues.map((e) => `${e.date} ${e.symbol} ${e.action}: ${e.reason}`),
      ...(!transactions.length && !snapshots.some((s) => s.positions.length)
        ? ['No dated security quantities: import trade history or a dated positions statement.']
        : []),
      ...(first > '2019-12-31'
        ? [
            `Records begin ${first}; no position is evidenced in 2019. If this account was open earlier, supply earlier purchases or a dated holdings statement.`,
          ]
        : []),
      ...(!snapshots.some((s) => s.cash !== null) && broker
        ? ['Cash is not recorded on historical dates; the line shows supported holdings values.']
        : []),
    ],
    sourceTradeCount: transactions.length,
    retainedSourceQuantityRows: sourceEvidence.rows.length,
    sourceSnapshotCount: snapshots.length,
  };
  // Commit small batches; progress survives a restart. Concurrent source changes retain their dirty generation.
  await connection.sequelize.transaction(async (transaction: Transaction) => {
    if (!continuing && work.currencyCode && work.currencyCode !== currency)
      await connection.sequelize.query('DELETE FROM "InvestmentDailyAccountValues" WHERE "portfolioId"=:id', {
        replacements: { id: portfolio.id },
        transaction,
      });
    else if (!continuing)
      await connection.sequelize.query(
        'DELETE FROM "InvestmentDailyAccountValues" WHERE "portfolioId"=:id AND date>=CAST(:from AS date)',
        { replacements: { id: portfolio.id, from: work.fromDate }, transaction },
      );
    await connection.sequelize.query(
      `INSERT INTO "InvestmentDailyAccountValues"("portfolioId","currencyCode",date,value,"knownValue","netFunding",coverage)
      SELECT :id,:currency,x.date,x.value,x.known,x.funding,x.coverage FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS x(date date,value numeric,known numeric,funding numeric,coverage jsonb)
      ON CONFLICT("portfolioId","currencyCode",date) DO UPDATE SET value=EXCLUDED.value,"knownValue"=EXCLUDED."knownValue","netFunding"=EXCLUDED."netFunding",coverage=EXCLUDED.coverage,"updatedAt"=now()`,
      {
        replacements: {
          id: portfolio.id,
          currency,
          rows: JSON.stringify(
            history.map((p) => ({
              date: p.date,
              value: p.marketValue,
              known: p.knownPortfolios?.[portfolio.id] ?? null,
              funding: p.knownNetInvested,
              coverage: coverage.get(p.date) ?? { priced: 0, missing: 0, unknown: 0, cash: false },
            })),
          ),
        },
        transaction,
      },
    );
    const done = through >= today;
    await connection.sequelize.query(
      `INSERT INTO "InvestmentHistoryState"("portfolioId","currencyCode","firstDate","lastDate","nextDate","pendingRevision",audit)
      VALUES(:id,:currency,:first,:through,:next,:revision,CAST(:audit AS jsonb)) ON CONFLICT("portfolioId") DO UPDATE SET "currencyCode"=EXCLUDED."currencyCode","firstDate"=EXCLUDED."firstDate","lastDate"=EXCLUDED."lastDate","nextDate"=EXCLUDED."nextDate","pendingRevision"=EXCLUDED."pendingRevision",audit=EXCLUDED.audit,"builtAt"=now()`,
      {
        replacements: {
          id: portfolio.id,
          currency,
          first,
          through,
          next: done ? null : nextDay(through),
          revision: work.revision,
          audit: JSON.stringify(audit),
        },
        transaction,
      },
    );
    if (done)
      await connection.sequelize.query(
        'DELETE FROM "InvestmentHistoryDirty" WHERE "portfolioId"=:id AND revision=:revision',
        { replacements: { id: portfolio.id, revision: work.revision }, transaction },
      );
  });
  return true;
}
