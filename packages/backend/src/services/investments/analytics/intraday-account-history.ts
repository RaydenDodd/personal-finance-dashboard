import { investmentPriceDate, usEquityObservationAllowed } from '@bt/shared/types/investment-market';
import BrokerPortfolioData from '@models/investments/broker-portfolio-data.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Securities from '@models/investments/securities.model';
import type { SecurityPriceRow } from '@services/stats/get-combined-balance-history/security-price-lookup';
import type { TransactionRow } from '@services/stats/get-combined-balance-history/types';
import { Op } from 'sequelize';

import { sqlRows } from './daily-account-cache';
import { buildHistory } from './history';

/** Bounded one-week replay through native quantity accounting; only account totals leave the backend. */
async function replayIntradayAccountHistory(ids: string[], currencyCode: string, from: string, through: string) {
  const [brokers, transactions, transfers, balances] = await Promise.all([
    BrokerPortfolioData.findAll({ where: { portfolioId: { [Op.in]: ids } } }),
    InvestmentTransaction.findAll({
      where: { portfolioId: { [Op.in]: ids } },
      attributes: [
        'portfolioId',
        'securityId',
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
      order: [['date', 'ASC']],
      raw: true,
    }) as unknown as Promise<TransactionRow[]>,
    PortfolioTransfers.findAll({
      where: { [Op.or]: [{ fromPortfolioId: { [Op.in]: ids } }, { toPortfolioId: { [Op.in]: ids } }] },
    }),
    PortfolioBalances.findAll({ where: { portfolioId: { [Op.in]: ids } } }),
  ]);
  const securityIds = [
    ...new Set([
      ...transactions.map((t) => t.securityId),
      ...brokers.flatMap((b) => b.data.snapshots.flatMap((s) => s.positions.map((p) => p.securityId))),
    ]),
  ];
  if (!securityIds.length) return [];
  const securities = await Securities.findAll({ where: { id: { [Op.in]: securityIds } } });
  const prices = await sqlRows<SecurityPriceRow>(
    `SELECT "securityId",date,"priceClose","unadjustedClose",source,"priceAsOf" FROM "SecurityPricings" WHERE "securityId" IN (:ids) AND date>=CAST(:from AS date)-INTERVAL '4 days' AND date<CAST(:through AS date)+INTERVAL '1 day' ORDER BY date`,
    { ids: securityIds, from, through },
  );
  const allowed = prices.filter((p) => !p.priceAsOf || p.source !== 'yahoo' || usEquityObservationAllowed(p.priceAsOf));
  const buckets = new Map<number, number>();
  for (const p of allowed) {
    if (
      !p.priceAsOf ||
      investmentPriceDate(p.priceAsOf, false) < from ||
      investmentPriceDate(p.priceAsOf, false) > through
    )
      continue;
    const time = +new Date(p.priceAsOf),
      bucket = Math.floor(time / 300000);
    buckets.set(bucket, Math.max(time, buckets.get(bucket) ?? 0));
  }
  const times = [...buckets.values()].sort((a, b) => a - b).map((time) => new Date(time).toISOString());
  if (!times.length) return [];
  return buildHistory({
    ids,
    currencyCode,
    brokers,
    transactions,
    transfers,
    balances,
    securities,
    prices: allowed,
    from,
    through,
    sampleTimes: times,
  });
}

const cache = new Map<string, { expires: number; value: ReturnType<typeof replayIntradayAccountHistory> }>();
export function intradayAccountHistory(ids: string[], currency: string, from: string, through: string) {
  const key = JSON.stringify([ids.toSorted(), currency, from, through]);
  const old = cache.get(key);
  if (old && old.expires > Date.now()) return old.value;
  const value = replayIntradayAccountHistory(ids, currency, from, through).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { expires: Date.now() + 60000, value });
  for (const [k, entry] of cache) if (entry.expires < Date.now()) cache.delete(k);
  return value;
}
