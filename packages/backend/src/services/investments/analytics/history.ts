import type { InvestmentHistoryPoint } from '@bt/shared/types/investment-analytics';
import {
  easternDate,
  usEquityCloseInstant,
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

export function prepareHistoryPriceIndex(prices: SecurityPriceRow[], priceDate: typeof investmentPriceDate, sharedUnitFactor?: ReturnType<typeof createShareUnitFactor>) {
  const shareUnitFactor = sharedUnitFactor ?? createShareUnitFactor(prices, priceDate);
  const findPrice = createFindPriceForDate(buildPriceLookup(prices, priceDate, true, shareUnitFactor));
  const observed = new Set(prices.map((p) => {
    const canonicalDaily = new Date(p.date).toISOString().endsWith('T00:00:00.000Z');
    return `${p.securityId}:${canonicalDaily ? priceDate(p.date) : priceDate(p.priceAsOf ?? p.date, false)}`;
  }));
  return { shareUnitFactor, findPrice, hasObserved: (securityId: string, date: string) => observed.has(`${securityId}:${date}`) };
}

/** Prepared indexes are independent by security: preserve all input observations,
 * date order and split handling while rebuilding only changed row sequences. */
export class HistoryPriceIndexCache {
  private entries = new Map<string, { rows: SecurityPriceRow[]; index: ReturnType<typeof prepareHistoryPriceIndex> }>();

  prepare(groups: ReadonlyMap<string, SecurityPriceRow[]>, dateKey: typeof investmentPriceDate, retain: boolean) {
    const active = new Map<string, { rows: SecurityPriceRow[]; index: ReturnType<typeof prepareHistoryPriceIndex> }>();
    let reused = 0, totalRows = 0;
    for (const [id, rows] of groups) {
      totalRows += rows.length;
      const old = retain ? this.entries.get(id) : undefined;
      const same = old && old.rows.length === rows.length && rows.every((row, i) => row === old.rows[i]);
      if (same) { active.set(id, old); reused++; }
      else active.set(id, { rows, index: prepareHistoryPriceIndex(rows, dateKey) });
    }
    this.entries = retain && totalRows <= 200000 ? active : new Map();
    return {
      reused,
      index: {
        shareUnitFactor: (id: string, day: string) => active.get(id)?.index.shareUnitFactor(id, day) ?? 1,
        findPrice: (id: string, day: string) => active.get(id)?.index.findPrice(id, day) ?? null,
        hasObserved: (id: string, day: string) => active.get(id)?.index.hasObserved(id, day) ?? false,
      },
    };
  }
}

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
  sampleTimes,
  positionDates,
  sharedUnitFactor,
  priceDate = investmentPriceDate,
  preparedPriceIndex,
}: {
  preparedPriceIndex?: ReturnType<typeof prepareHistoryPriceIndex>;
  priceDate?: typeof investmentPriceDate;
  /** Optional identical price-row factor supplied by the current analytics calculation. */
  sharedUnitFactor?: ReturnType<typeof createShareUnitFactor>;
  /** Only replay requested dates for position callbacks; no account-history series is returned. */
  positionDates?: readonly string[];
  sampleTimes?: string[];
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
  const nativeByPortfolio = Map.groupBy(transactions, (t) => String(t.portfolioId));
  transactions = [
    ...transactions,
    ...brokers.flatMap(
      (b) =>
        sourceQuantityEvidence(
          b.portfolioId,
          b.data,
          securities,
          nativeByPortfolio.get(b.portfolioId) ?? [],
        ).rows,
    ),
  ].sort((a, b) => +new Date(a.date) - +new Date(b.date));
  const liveDay = easternDate();
  const today = through ?? liveDay;
  const starts = [
    ...transactions.map((t) => investmentPriceDate(t.date)),
    ...transfers.map((t) => t.date),
    ...brokers.flatMap((b) => b.data.snapshots.map((s) => investmentPriceDate(s.asOf))),
    ...brokers.flatMap((b) => (b.data.accountObservations ?? []).map((o) => o.date)),
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
  if (sampleTimes) dates.splice(0, dates.length, ...sampleTimes);
  if (positionDates) dates.splice(0, dates.length, ...[...new Set(positionDates)].filter((d) => d >= starts[0]! && d <= today).sort());
  const dateSet = new Set(dates);
  const transactionsByPortfolio = Map.groupBy(transactions, (t) => String(t.portfolioId));
  const transfersByDay = Map.groupBy(transfers, (t) => t.date);
  const observedBrokerDates = new Set<string>();
  for (const broker of brokers) {
    if (!ids.includes(broker.portfolioId)) continue;
    for (const snapshot of broker.data.snapshots) observedBrokerDates.add(investmentPriceDate(snapshot.asOf));
    for (const observation of broker.data.accountObservations ?? []) observedBrokerDates.add(observation.date);
  }
  const observationTime = (p: SecurityPriceRow) =>
    p.priceAsOf ? +new Date(p.priceAsOf) : usEquityCloseInstant(investmentPriceDate(p.date));
  const intradayPrices = new Map<string, SecurityPriceRow[]>();
  if (sampleTimes)
    for (const price of prices) {
      const rows = intradayPrices.get(price.securityId) ?? [];
      rows.push(price);
      intradayPrices.set(price.securityId, rows);
    }
  for (const rows of intradayPrices.values()) rows.sort((a, b) => observationTime(a) - observationTime(b));
  const byBroker = new Map(brokers.map((b) => [b.portfolioId, b]));
  const byPortfolio = new Map<string, Map<string, string | null>>();
  const knownByPortfolio = new Map<string, Map<string, string | null>>();
  const { shareUnitFactor, findPrice, hasObserved } = preparedPriceIndex ?? prepareHistoryPriceIndex(prices, priceDate, sharedUnitFactor);
  const securityById = new Map<string, Securities>(securities.map((s) => [s.id, s]));
  const sessionPriceDates = new Map<string, string>();
  const stockPriceDay = (date: string) => {
    let day = sessionPriceDates.get(date);
    if (!day) {
      day = usEquitySession(date).tradingDay ? date : previousUsEquitySession(date);
      sessionPriceDates.set(date, day);
    }
    return day;
  };
  const livePriorClose = previousUsEquitySession(liveDay);
  for (const id of ids) {
    const broker = byBroker.get(id);
    const values = new Map<string, string | null>();
    const known = new Map<string, string | null>();
    const txs = transactionsByPortfolio.get(id) ?? [];
    const snapshots = [...(broker?.data.snapshots ?? [])]
      .filter((s) => s.currencyCode === currencyCode)
      .sort((a, b) => a.asOf.localeCompare(b.asOf));
    const snapshotsByDay = Map.groupBy(snapshots, (s) => investmentPriceDate(s.asOf));
    const anchors = positionEvidence(snapshots, txs, shareUnitFactor);
    const firstCompleteAnchor = anchors.filter((a) => a.complete).map((a) => investmentPriceDate(a.asOf)).sort()[0];
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
    for (const observation of broker?.data.accountObservations ?? [])
      cashByDate.set(observation.date, observation.cash);
    const firstEvidence = [
      ...txs
        .filter((t) => ['buy', 'sell', 'transfer'].includes(t.category) && Number(t.quantity) !== 0)
        .map((t) => investmentPriceDate(t.date)),
      ...snapshots
        .filter((s) => s.positions?.length || (s.complete && Array.isArray(s.positions)))
        .map((s) => investmentPriceDate(s.asOf)),
      ...(broker?.data.accountObservations ?? []).map((o) => o.date),
    ].sort()[0];
    const supportedDates = dates.filter((d) => firstEvidence && d >= firstEvidence);
    const replay = computeHoldingsValueByDate({
      uniqueDates: supportedDates,
      portfolioIds: [id],
      transactionsByPortfolio: new Map([[id, txs]]),
      securitiesById: securityById,
      findPriceForDate: (securityId, date) => {
        if (sampleTimes) {
          const observations = intradayPrices.get(securityId) ?? [];
          const target = Date.parse(date);
          let low = 0,
            high = observations.length;
          while (low < high) {
            const mid = (low + high) >>> 1;
            if (observationTime(observations[mid]!) <= target) low = mid + 1;
            else high = mid;
          }
          const observation = observations[low - 1];
          if (!observation || Date.parse(date) - observationTime(observation) > 4 * 86400000) return null;
          return (
            Number(observation.unadjustedClose ?? observation.priceClose) /
            shareUnitFactor(securityId, date.slice(0, 10))
          );
        }
        const security = securityById.get(securityId);
        const expected = security?.assetClass === 'crypto' ? date : stockPriceDay(date);
        // Today's account value retains a real prior close until a regular quote arrives.
        // This is a valuation fallback, never a new price observation or a historical gap fill.
        const prior = livePriorClose;
        const price = hasObserved(securityId, expected)
          ? findPrice(securityId, date)
          : date === liveDay && security?.assetClass !== 'crypto' && hasObserved(securityId, prior)
            ? findPrice(securityId, prior)
            : null;
        if (price !== null) return price;
        const snapshot = snapshotsByDay.get(date)?.findLast(
          (s) => s.positions?.some((p) => p.securityId === securityId && p.marketValue !== null),
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
      dateKey: sampleTimes ? (date) => new Date(date).toISOString() : investmentPriceDate,
      shareUnitFactor,
      mergePositionAnchors: true,
      positionAnchorsByPortfolio: new Map([[id, anchors]]),
      onHoldingValue: (row) => {
        if (!Number.isFinite(row.value)) return;
        if (positionDates) { onHoldingValue?.(row); return; }
        const old = priced.get(row.date) ?? { value: new Big(0), count: 0 };
        old.value = old.value.plus(row.value);
        old.count++;
        priced.set(row.date, old);
        onHoldingValue?.(row);
      },
    });
    if (positionDates) continue;
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
      const universeKnown = !broker || (firstCompleteAnchor !== undefined && firstCompleteAnchor <= d);
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
      if (dateSet.has(d) && s.complete && s.totalValue !== null) {
        values.set(d, s.totalValue);
        known.set(d, s.totalValue);
      }
    }
    for (const observation of broker?.data.accountObservations ?? []) {
      if (dateSet.has(observation.date)) {
        values.set(observation.date, observation.totalValue);
        known.set(observation.date, observation.totalValue);
      }
    }
    byPortfolio.set(id, values);
    for (const [date, value] of values) if (value !== null) known.set(date, value);
    knownByPortfolio.set(id, known);
  }
  if (positionDates) return [];
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
    const dailyFlows = (transfersByDay.get(date) ?? []).map((t) => new Big(nativeExternalFlow(t, selected)));
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
      source: observedBrokerDates.has(date)
        ? 'Recorded broker observations / native history'
        : 'Native historical valuation; missing prices remain unavailable',
    };
  });
}
