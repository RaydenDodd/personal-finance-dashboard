import type { InvestmentHistoryPoint } from '@bt/shared/types/investment-analytics';
import type BrokerPortfolioData from '@models/investments/broker-portfolio-data.model';
import type PortfolioBalances from '@models/investments/portfolio-balances.model';
import type PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import type Securities from '@models/investments/securities.model';
import type SecurityPricing from '@models/investments/security-pricing.model';
import { computeHoldingsValueByDate } from '@services/stats/get-combined-balance-history/holdings-replay';
import {
  accumulateCashDeltas,
  computePortfolioCashByDate,
} from '@services/stats/get-combined-balance-history/portfolio-cash-replay';
import {
  buildPriceLookup,
  createFindPriceForDate,
} from '@services/stats/get-combined-balance-history/security-price-lookup';
import type { TransactionRow } from '@services/stats/get-combined-balance-history/types';
import Big from 'big.js';

import { externalFlow, sum } from './math';

/** Read adapter over the native history replay; no parallel transaction or lot accounting. */
export function buildHistory({
  ids,
  currencyCode,
  brokers,
  transactions,
  transfers,
  balances,
  securities,
  prices,
}: {
  ids: string[];
  currencyCode: string;
  brokers: BrokerPortfolioData[];
  transactions: TransactionRow[];
  transfers: PortfolioTransfers[];
  balances: PortfolioBalances[];
  securities: Securities[];
  prices: SecurityPricing[];
}): InvestmentHistoryPoint[] {
  const today = new Date().toISOString().slice(0, 10);
  const starts = [
    ...transactions.map((t) => new Date(t.date).toISOString().slice(0, 10)),
    ...transfers.map((t) => t.date),
    ...brokers.flatMap((b) => b.data.snapshots.map((s) => s.asOf.slice(0, 10))),
  ]
    .filter((d) => d <= today)
    .sort();
  if (!starts.length) return [];
  const dates: string[] = [];
  for (
    let d = new Date(`${starts[0]}T00:00:00Z`);
    d.toISOString().slice(0, 10) <= today && dates.length < 20000;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    dates.push(d.toISOString().slice(0, 10));
  const byBroker = new Map(brokers.map((b) => [b.portfolioId, b]));
  const byPortfolio = new Map<string, Map<string, string | null>>();
  const findPrice = createFindPriceForDate(buildPriceLookup(prices));
  for (const id of ids) {
    const broker = byBroker.get(id);
    const values = new Map<string, string | null>();
    if (broker && !broker.data.historyComplete) {
      // A current composition is never copied backwards through incomplete imports.
      for (const s of broker.data.snapshots)
        if (s.complete && s.totalValue !== null && s.currencyCode === currencyCode)
          values.set(s.asOf.slice(0, 10), s.totalValue);
    } else {
      const txs = transactions.filter((t) => t.portfolioId === id);
      const cash = balances.filter((b) => b.portfolioId === id);
      const missing = new Set<string>();
      let badFxDate: string | null = null;
      const rate = (code: string, date: string) => {
        if (code !== currencyCode) {
          badFxDate = date;
          missing.add(date);
        }
        return 1;
      };
      const holdingValues = computeHoldingsValueByDate({
        uniqueDates: dates,
        portfolioIds: [id],
        transactionsByPortfolio: new Map([[id, txs]]),
        securitiesById: new Map(securities.map((s) => [s.id, s])),
        findPriceForDate: findPrice,
        getExchangeRate: rate,
        onMissingPrice: ({ dateStr }) => missing.add(dateStr),
      });
      const cashValues = computePortfolioCashByDate({
        uniqueDates: dates,
        maxDate: today,
        todayKey: today,
        currentBalances: cash,
        getExchangeRate: rate,
        cashDeltaByCurrencyDay: accumulateCashDeltas({
          transactions: txs,
          portfolioTransfers: transfers.filter(
            (t) => t.affectsCash && (t.fromPortfolioId === id || t.toPortfolioId === id),
          ),
          portfolioIdSet: new Set([id]),
        }),
      });
      for (const d of dates)
        values.set(
          d,
          missing.has(d) || badFxDate === d
            ? null
            : new Big(holdingValues.get(d) ?? 0).plus(cashValues.get(d) ?? 0).toString(),
        );
      // Exact source observations supersede the shared replay only on their real date.
      for (const s of broker?.data.snapshots ?? [])
        if (s.complete && s.totalValue !== null && s.currencyCode === currencyCode)
          values.set(s.asOf.slice(0, 10), s.totalValue);
    }
    byPortfolio.set(id, values);
  }
  const selected = new Set(ids);
  const complete = ids.every((id) => byBroker.get(id)?.data.historyComplete !== false);
  let contributions = new Big(0);
  let withdrawals = new Big(0);
  const flowsByDay = new Map<string, Big>();
  for (const t of transfers) {
    const f = new Big(
      externalFlow(
        { ...t, refAmount: t.refAmount.toDecimalString(18), refToAmount: t.refToAmount?.toDecimalString(18) },
        selected,
      ),
    );
    flowsByDay.set(t.date, (flowsByDay.get(t.date) ?? new Big(0)).plus(f));
  }
  return dates.map((date) => {
    const dailyFlows = transfers
      .filter((t) => t.date === date)
      .map(
        (t) =>
          new Big(
            externalFlow(
              { ...t, refAmount: t.refAmount.toDecimalString(18), refToAmount: t.refToAmount?.toDecimalString(18) },
              selected,
            ),
          ),
      );
    const incoming = dailyFlows.filter((v) => v.gt(0)).reduce((n, v) => n.plus(v), new Big(0));
    const outgoing = dailyFlows.filter((v) => v.lt(0)).reduce((n, v) => n.minus(v), new Big(0));
    contributions = contributions.plus(incoming);
    withdrawals = withdrawals.plus(outgoing);
    const portfolios = Object.fromEntries(ids.map((id) => [id, byPortfolio.get(id)?.get(date) ?? null]));
    const marketValue = sum(Object.values(portfolios));
    const net = complete ? contributions.minus(withdrawals).toString() : null;
    return {
      date,
      marketValue,
      netInvested: net,
      cumulativeGain: marketValue !== null && net !== null ? new Big(marketValue).minus(net).toString() : null,
      unrealizedGain: null,
      realizedGain: null,
      returnPercent: null,
      contributions: incoming.toString(),
      withdrawals: outgoing.toString(),
      portfolios,
      coverage: ids.length ? (Object.values(portfolios).filter((v) => v !== null).length / ids.length) * 100 : 0,
      source: ids.some((id) => byBroker.get(id)?.data.snapshots.some((s) => s.asOf.slice(0, 10) === date))
        ? 'Recorded broker observations / native history'
        : 'Native historical valuation; missing prices remain unavailable',
    };
  });
}
