import type { InvestmentHistoryPoint } from '@bt/shared/types/investment-analytics';
import {
  easternDate,
  investmentPriceDate,
  usEquitySession,
  previousUsEquitySession,
} from '@bt/shared/types/investment-market';
import type BrokerPortfolioData from '@models/investments/broker-portfolio-data.model';
import type PortfolioBalances from '@models/investments/portfolio-balances.model';
import type PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import type Securities from '@models/investments/securities.model';
import { computeHoldingsValueByDate } from '@services/stats/get-combined-balance-history/holdings-replay';
import {
  accumulateCashDeltas,
  computePortfolioCashByDate,
} from '@services/stats/get-combined-balance-history/portfolio-cash-replay';
import {
  buildPriceLookup,
  createFindPriceForDate,
  createShareUnitFactor,
  type SecurityPriceRow,
} from '@services/stats/get-combined-balance-history/security-price-lookup';
import type { TransactionRow } from '@services/stats/get-combined-balance-history/types';
import Big from 'big.js';

import { sum } from './math';
import { nativeExternalFlow } from './native-transfer';
import { positionEvidence } from './position-evidence';
import { sourceQuantityEvidence } from './source-quantity-evidence';

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
  onHoldingValue,
  from,
  through,
  onCoverage,
  onHoldingQuantity,
  onAnchorDifference,
}: {
  ids: string[];
  currencyCode: string;
  brokers: BrokerPortfolioData[];
  transactions: TransactionRow[];
  transfers: PortfolioTransfers[];
  balances: PortfolioBalances[];
  securities: Securities[];
  prices: SecurityPriceRow[];
  from?: string;
  through?: string;
  onCoverage?: (row: {
    portfolioId: string;
    date: string;
    priced: number;
    missingPrices: string[];
    unknownQuantities: string[];
    cashKnown: boolean;
    fxMissing: boolean;
  }) => void;
  onHoldingQuantity?: (row: { portfolioId: string; securityId: string; date: string; quantity: number | null }) => void;
  onAnchorDifference?: (row: {
    portfolioId: string;
    securityId: string;
    date: string;
    expected: number | null;
    observed: number;
  }) => void;
  onHoldingValue?: (row: {
    portfolioId: string;
    securityId: string;
    date: string;
    value: number;
    quantity: number;
  }) => void;
}): InvestmentHistoryPoint[] {
  transactions = [
    ...transactions,
    ...brokers.flatMap(
      (b) =>
        sourceQuantityEvidence(
          b.portfolioId,
          b.data,
          securities,
          transactions.filter((t) => t.portfolioId === b.portfolioId),
        ).rows,
    ),
  ].sort((a, b) => +new Date(a.date) - +new Date(b.date));
  const today = through ?? easternDate();
  const starts = [
    ...transactions.map((t) => investmentPriceDate(t.date)),
    ...transfers.map((t) => t.date),
    ...brokers.flatMap((b) => b.data.snapshots.map((s) => investmentPriceDate(s.asOf))),
    ...brokers.flatMap((b) =>
      (b.data.sourceEvents ?? [])
        .filter((e) => ['REC', 'SXCH', 'SPR'].includes(String(e.action)) && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date)))
        .map((e) => String(e.date)),
    ),
  ]
    .filter((d) => d <= today)
    .sort();
  if (!starts.length) return [];
  const dates: string[] = [];
  for (
    let d = new Date(`${from && from > starts[0]! ? from : starts[0]}T00:00:00Z`);
    d.toISOString().slice(0, 10) <= today;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    dates.push(d.toISOString().slice(0, 10));
  const byBroker = new Map(brokers.map((b) => [b.portfolioId, b]));
  const byPortfolio = new Map<string, Map<string, string | null>>();
  const knownByPortfolio = new Map<string, Map<string, string | null>>();
  const findPrice = createFindPriceForDate(buildPriceLookup(prices, investmentPriceDate, true));
  const shareUnitFactor = createShareUnitFactor(prices, investmentPriceDate);
  const observed = new Set(
    prices.map((p) => `${p.securityId}:${investmentPriceDate(p.priceAsOf ?? p.date, p.priceAsOf ? false : undefined)}`),
  );
  const securityById = new Map<string, Securities>(securities.map((s) => [s.id, s]));
  for (const id of ids) {
    const broker = byBroker.get(id);
    const values = new Map<string, string | null>();
    const known = new Map<string, string | null>();
    const txs = transactions.filter((t) => t.portfolioId === id);
    const snapshots = [...(broker?.data.snapshots ?? [])]
      .filter((s) => s.currencyCode === currencyCode)
      .sort((a, b) => a.asOf.localeCompare(b.asOf));
    const anchors = positionEvidence(snapshots, txs, shareUnitFactor);
    const missing = new Map<string, Set<string>>(),
      unknown = new Map<string, Set<string>>(),
      badFx = new Set<string>();
    const priced = new Map<string, { value: Big; count: number }>();
    const mark = (map: Map<string, Set<string>>, date: string, id: string) => {
      const set = map.get(date) ?? new Set<string>();
      set.add(id);
      map.set(date, set);
    };
    const cashByDate = new Map(
      snapshots.filter((s) => s.cash !== null).map((s) => [investmentPriceDate(s.asOf), s.cash!]),
    );
    const firstEvidence = [
      ...txs
        .filter((t) => ['buy', 'sell', 'transfer'].includes(t.category) && Number(t.quantity) !== 0)
        .map((t) => investmentPriceDate(t.date)),
      ...snapshots
        .filter((s) => s.positions?.length || (s.complete && Array.isArray(s.positions)))
        .map((s) => investmentPriceDate(s.asOf)),
    ].sort()[0];
    const supportedDates = dates.filter((d) => firstEvidence && d >= firstEvidence);
    const replay = computeHoldingsValueByDate({
      uniqueDates: supportedDates,
      portfolioIds: [id],
      transactionsByPortfolio: new Map([[id, txs]]),
      securitiesById: new Map(securities.map((s) => [s.id, s])),
      findPriceForDate: (securityId, date) => {
        const security = securityById.get(securityId);
        const expected =
          security?.assetClass === 'crypto' || usEquitySession(date).tradingDay ? date : previousUsEquitySession(date);
        const price = observed.has(`${securityId}:${expected}`) ? findPrice(securityId, date) : null;
        if (price !== null) return price;
        const snapshot = snapshots.findLast(
          (s) =>
            investmentPriceDate(s.asOf) === date &&
            s.positions?.some((p) => p.securityId === securityId && p.marketValue !== null),
        );
        const p = snapshot?.positions.find((p) => p.securityId === securityId);
        const qty = p ? Number(p.quantity) * shareUnitFactor(securityId, date) : 0;
        return p?.marketValue != null && qty > 0 ? Number(p.marketValue) / qty : null;
      },
      getExchangeRate: (code, date) => {
        if (code !== currencyCode) {
          badFx.add(date);
          return NaN;
        }
        return 1;
      },
      onMissingPrice: ({ securityId, dateStr }) => mark(missing, dateStr, securityId),
      onUnknownQuantity: ({ securityId, dateStr }) => mark(unknown, dateStr, securityId),
      onHoldingQuantity,
      onAnchorDifference,
      floorValues: false,
      dateKey: investmentPriceDate,
      shareUnitFactor,
      mergePositionAnchors: true,
      positionAnchorsByPortfolio: new Map([[id, anchors]]),
      onHoldingValue: (row) => {
        if (!Number.isFinite(row.value)) return;
        const old = priced.get(row.date) ?? { value: new Big(0), count: 0 };
        old.value = old.value.plus(row.value);
        old.count++;
        priced.set(row.date, old);
        onHoldingValue?.(row);
      },
    });
    if (!broker && balances.some((b) => b.portfolioId === id)) {
      const cash = computePortfolioCashByDate({
        uniqueDates: dates,
        maxDate: today,
        todayKey: today,
        currentBalances: balances.filter((b) => b.portfolioId === id),
        getExchangeRate: (code, date) => {
          if (code !== currencyCode) badFx.add(date);
          return 1;
        },
        cashDeltaByCurrencyDay: accumulateCashDeltas({
          transactions: txs,
          portfolioTransfers: transfers.filter(
            (t) => t.affectsCash && (t.fromPortfolioId === id || t.toPortfolioId === id),
          ),
          portfolioIdSet: new Set([id]),
        }),
      });
      for (const [date, value] of cash) cashByDate.set(date, String(value));
    }
    for (const d of supportedDates) {
      const p = priced.get(d),
        missingPrices = [...(missing.get(d) ?? [])],
        unknownQuantities = [...(unknown.get(d) ?? [])];
      const hasUnknown = missingPrices.length > 0 || unknownQuantities.length > 0 || badFx.has(d);
      const holdings = p ? p.value.toString() : hasUnknown ? null : String(replay.get(d) ?? 0);
      const cash = cashByDate.get(d);
      const subtotal = holdings !== null ? new Big(holdings).plus(cash ?? 0).toString() : (cash ?? null);
      known.set(d, subtotal);
      const universeKnown = !broker || anchors.some((a) => a.complete && investmentPriceDate(a.asOf) <= d);
      values.set(d, universeKnown && cash !== undefined && !hasUnknown ? subtotal : null);
      onCoverage?.({
        portfolioId: id,
        date: d,
        priced: p?.count ?? 0,
        missingPrices,
        unknownQuantities,
        cashKnown: cash !== undefined,
        fxMissing: badFx.has(d),
      });
    }
    for (const s of snapshots) {
      const d = investmentPriceDate(s.asOf);
      if (dates.includes(d) && s.complete && s.totalValue !== null) {
        values.set(d, s.totalValue);
        known.set(d, s.totalValue);
      }
    }
    byPortfolio.set(id, values);
    for (const [date, value] of values) if (value !== null) known.set(date, value);
    knownByPortfolio.set(id, known);
  }
  const selected = new Set(ids);
  const complete = ids.every((id) => byBroker.get(id)?.data.historyComplete !== false);
  let contributions = new Big(0);
  let withdrawals = new Big(0);
  for (const t of transfers.filter((t) => t.date < (dates[0] ?? today))) {
    const flow = new Big(nativeExternalFlow(t, selected));
    if (flow.gt(0)) contributions = contributions.plus(flow);
    else withdrawals = withdrawals.minus(flow);
  }
  return dates.map((date) => {
    const dailyFlows = transfers.filter((t) => t.date === date).map((t) => new Big(nativeExternalFlow(t, selected)));
    const incoming = dailyFlows.filter((v) => v.gt(0)).reduce((n, v) => n.plus(v), new Big(0));
    const outgoing = dailyFlows.filter((v) => v.lt(0)).reduce((n, v) => n.minus(v), new Big(0));
    contributions = contributions.plus(incoming);
    withdrawals = withdrawals.plus(outgoing);
    const portfolios = Object.fromEntries(ids.map((id) => [id, byPortfolio.get(id)?.get(date) ?? null]));
    const marketValue = sum(Object.values(portfolios));
    const knownPortfolios = Object.fromEntries(ids.map((id) => [id, knownByPortfolio.get(id)?.get(date) ?? null]));
    const knownValues = Object.values(knownPortfolios).filter((v): v is string => v !== null);
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
      knownPortfolios,
      knownMarketValue: knownValues.length ? sum(knownValues) : null,
      knownNetInvested: transfers.length ? contributions.minus(withdrawals).toString() : null,
      coverage: ids.length ? (Object.values(portfolios).filter((v) => v !== null).length / ids.length) * 100 : 0,
      source: ids.some((id) => byBroker.get(id)?.data.snapshots.some((s) => investmentPriceDate(s.asOf) === date))
        ? 'Recorded broker observations / native history'
        : 'Native historical valuation; missing prices remain unavailable',
    };
  });
}
