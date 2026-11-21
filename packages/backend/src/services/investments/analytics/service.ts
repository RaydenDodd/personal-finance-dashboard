import type {
  InvestmentAnalytics,
  InvestmentHolding,
  InvestmentPortfolio,
  InvestmentMetric,
  InvestmentBenchmark,
} from '@bt/shared/types/investment-analytics';
import {
  easternDate,
  investmentPriceDate,
  usEquityMarketOpen,
  usEquitySession,
  previousUsEquitySession,
  usEquityObservationAllowed,
} from '@bt/shared/types/investment-market';
import { Money } from '@common/types/money';
import { ValidationError } from '@js/errors';
import BrokerPortfolioData from '@models/investments/broker-portfolio-data.model';
import InvestmentFundSnapshots from '@models/investments/fund-holdings-snapshot.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import UserSettings from '@models/user-settings.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import { withDeduplication } from '@services/common/with-deduplication';
import { latestSnapshot } from '@services/investments/broker-records/schema';
import { fillMissingCompanyClassifications } from '@services/investments/classification-values';
import { isCompositionIdentityConflict, isFundSecurity } from '@services/investments/composition/registry';
import {
  compositionStatuses,
  getCompositionAttempts,
  getCompositionSchedule,
} from '@services/investments/composition/service';
import { getHoldingValues } from '@services/investments/holdings/get-holding-values.service';
import { getPortfolioSummary } from '@services/investments/portfolios/get-portfolio-summary.service';
import { usesUsEquitySession } from '@services/investments/securities-price/regular-session';
import {
  createShareUnitFactor,
  type SecurityPriceRow,
} from '@services/stats/get-combined-balance-history/security-price-lookup';
import type { TransactionRow } from '@services/stats/get-combined-balance-history/types';
import Big from 'big.js';
import { Op, literal } from 'sequelize';

import { compactAnalytics } from './compact-response';
import { dailyPositionChange } from './daily-performance';
import { getFundSnapshots, latestFundSnapshots } from './fund-snapshots';
import { buildHistory } from './history';
import {
  allocation,
  fundOverlap,
  lookThrough,
  metric,
  percent,
  resolveFundIdentities,
  sum,
  isCompanyExposure,
  investmentIssuerCountry,
} from './math';
import { nativeExternalFlow } from './native-transfer';
import { consolidatedReturns, normalizeComparableSeries, recordedPriceReturns } from './performance';
import { positionPeriodDates, positionPeriodReturns } from './position-performance';
import { currentHoldingsPriceRisk } from './price-risk';

const decimal = (m: Money | string | number): string => (Money.isMoney(m) ? m.toDecimalString(18) : String(m));
const dateString = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export const assertOwnedSelection = (requested: string[] | undefined, owned: string[]): string[] => {
  if (!requested?.length) return owned;
  const valid = new Set(owned);
  if (requested.some((id) => !valid.has(id)))
    throw new ValidationError({ message: 'One or more selected portfolios are unavailable.' });
  return [...new Set(requested)];
};
export const visiblePortfolioSelection = (requested: string[] | undefined, owned: string[], hidden: string[]) =>
  assertOwnedSelection(requested, owned).filter((id) => !hidden.includes(id));

async function getAnalyticsImpl({
  userId,
  portfolioIds,
  benchmarkSymbols = ['SPY', 'QQQ', 'VTI', 'VT'],
  hiddenPortfolioIds = [],
  performanceFrom,
  performanceThrough,
  compact = false,
  overlapPair,
}: {
  userId: number;
  portfolioIds?: string[];
  benchmarkSymbols?: string[];
  hiddenPortfolioIds?: string[];
  compositionRevision?: string;
  performanceFrom?: string;
  performanceThrough?: string;
  compact?: boolean;
  overlapPair?: [string, string];
}): Promise<InvestmentAnalytics> {
  const allPortfolios = await Portfolios.findAll({ where: { userId }, order: [['name', 'ASC']] });
  const ids = visiblePortfolioSelection(
    portfolioIds,
    allPortfolios.map((p) => p.id),
    hiddenPortfolioIds,
  );
  const selected = new Set(ids);
  const scope = allPortfolios.filter((p) => selected.has(p.id));
  const userCurrency = await UsersCurrencies.getCurrency({ userId, isDefaultCurrency: true });
  const currencyCode = userCurrency?.currency.code ?? 'USD';
  const today = easternDate();
  const [brokers, balances, transactions, transfers, storedSnapshots] = await Promise.all([
    BrokerPortfolioData.findAll({ where: { portfolioId: { [Op.in]: ids } } }),
    PortfolioBalances.findAll({ where: { portfolioId: { [Op.in]: ids } } }),
    InvestmentTransaction.findAll({
      where: { portfolioId: { [Op.in]: ids }, date: { [Op.lte]: `${today}T23:59:59.999Z` } },
      include: [{ model: Securities, as: 'security' }],
      order: [
        ['date', 'ASC'],
        ['createdAt', 'ASC'],
      ],
    }),
    PortfolioTransfers.findAll({
      where: {
        userId,
        date: { [Op.lte]: today },
        [Op.or]: [{ fromPortfolioId: { [Op.in]: ids } }, { toPortfolioId: { [Op.in]: ids } }],
      },
      order: [['date', 'ASC']],
    }),
    getFundSnapshots(userId),
  ]);
  let fundSnapshots = latestFundSnapshots(storedSnapshots, today);
  const brokerById = new Map(brokers.map((b) => [b.portfolioId, b]));
  const portfolioById = new Map<string, Portfolios>(scope.map((p) => [p.id, p]));
  const allHoldingValues: Awaited<ReturnType<typeof getHoldingValues>> = [];
  const summaries = new Map<string, Awaited<ReturnType<typeof getPortfolioSummary>>>();
  // Existing position/cost-basis/gain engine remains the only source of per-account values.
  for (const portfolio of scope) {
    summaries.set(portfolio.id, await getPortfolioSummary({ portfolioId: portfolio.id, userId }));
    allHoldingValues.push(...(await getHoldingValues({ portfolioId: portfolio.id, userId })));
  }
  const securityIds = [
    ...new Set([...allHoldingValues.map((h) => h.securityId), ...transactions.map((t) => t.securityId)]),
  ];
  const securities = securityIds.length ? await Securities.findAll({ where: { id: { [Op.in]: securityIds } } }) : [];
  fundSnapshots = resolveFundIdentities(fundSnapshots, securities);
  const benchmarksSecurities = await Securities.findAll({
    where: { symbol: { [Op.in]: benchmarkSymbols }, currencyCode },
  });
  const loadedPrices = (await SecurityPricing.findAll({
    where: {
      securityId: { [Op.in]: [...new Set([...securityIds, ...benchmarksSecurities.map((s) => s.id)])] },
      date: { [Op.lte]: new Date() },
      // Account analytics replay daily values. Keep daily bars and recent real
      // quotes; individual security charts still load the complete native history.
      [Op.or]: [
        { priceAsOf: null },
        literal(`("date" AT TIME ZONE 'UTC') = date_trunc('day', "date" AT TIME ZONE 'UTC')`),
        { date: { [Op.gte]: new Date(Date.now() - 7 * 86400000) } },
      ],
    },
    order: [['date', 'ASC']],
    attributes: ['securityId', 'date', 'priceClose', 'unadjustedClose', 'source', 'priceAsOf', 'previousClose'],
    raw: true,
  })) as unknown as (SecurityPriceRow & Pick<SecurityPricing, 'previousClose'>)[];
  const usSessionIds = new Set(
    [...securities, ...benchmarksSecurities].filter(usesUsEquitySession).map((s) => String(s.id)),
  );
  const prices = loadedPrices.filter(
    (p) =>
      p.source !== 'yahoo' ||
      !p.priceAsOf ||
      !!p.previousClose ||
      !usSessionIds.has(p.securityId) ||
      usEquityObservationAllowed(p.priceAsOf),
  );
  const pricesBySecurity = new Map<string, (typeof prices)[number][]>(Map.groupBy(prices, (p) => p.securityId));
  const health: InvestmentAnalytics['health'] = [];
  const holdingsByIdentity = new Map<string, InvestmentHolding>();
  for (const h of allHoldingValues) {
    const security = h.security;
    if (!security || new Big(h.quantity).eq(0)) continue;
    const broker = brokerById.get(h.portfolioId);
    const baseRate = h.currencyCode === currencyCode ? '1' : h.baseRate === undefined ? null : String(h.baseRate);
    const marketValue =
      h.marketValueKnown !== false && h.priceDate && baseRate !== null
        ? new Big(h.marketValue ?? 0).times(baseRate).toString()
        : null;
    const basis =
      h.costBasisKnown !== false && baseRate !== null ? new Big(h.costBasis).times(baseRate).toString() : null;
    const realized =
      h.realizedGainKnown !== false && baseRate !== null
        ? new Big(h.realizedGainValue ?? 0).times(baseRate).toString()
        : null;
    // Same stable database security id consolidates all accounts; no ticker-only merges.
    const id = security.id;
    const prior = holdingsByIdentity.get(id);
    const account = {
      portfolioId: h.portfolioId,
      portfolioName: portfolioById.get(h.portfolioId)?.name ?? 'Portfolio',
      reportedAverageCost: h.reportedAverageCost,
      quantity: h.quantity,
      costBasis: basis,
      averageCost:
        h.costBasisKnown !== false && new Big(h.quantity).gt(0)
          ? new Big(h.costBasis).div(h.quantity).toString()
          : null,
      marketValue,
      unrealizedGain: marketValue !== null && basis !== null ? new Big(marketValue).minus(basis).toString() : null,
      source: h.valuationSource ?? security.providerName,
      updatedAt: dateString(h.priceDate),
    };
    const row: InvestmentHolding = prior ?? {
      id,
      securityId: security.id,
      symbol: security.symbol ?? security.providerSymbol,
      name: security.name ?? security.symbol ?? security.providerSymbol,
      securityType: security.assetClass,
      assetClass: security.assetClass,
      currencyCode: security.currencyCode,
      exchange: security.exchangeMic ?? security.exchangeAcronym,
      quantity: '0',
      averageCost: null,
      costBasis: '0',
      price: h.latestPrice ?? null,
      priceDate: dateString(h.priceDate),
      marketValue: '0',
      unrealizedGain: '0',
      unrealizedPercent: null,
      realizedGain: '0',
      dividends: null,
      dailyChange: null,
      dailyChangePercent: null,
      weight: null,
      portfolioCount: 0,
      isFund:
        !isCompositionIdentityConflict(security) &&
        (fundSnapshots.some((f) => f.fundId === id) || isFundSecurity(security)),
      accounts: [],
      quality: 'verified',
    };
    row.quantity = new Big(row.quantity).plus(h.quantity).toString();
    row.marketValue = sum([row.marketValue, marketValue]);
    row.costBasis = sum([row.costBasis, basis]);
    row.realizedGain = sum([row.realizedGain, realized]);
    row.accounts.push(account);
    row.portfolioCount = row.accounts.length;
    if (basis === null || marketValue === null || broker?.data.historyComplete === false) row.quality = 'partial';
    if (dateString(h.priceDate) && (!row.priceDate || dateString(h.priceDate)! < row.priceDate))
      row.priceDate = dateString(h.priceDate);
    holdingsByIdentity.set(id, row);
  }
  const holdings = [...holdingsByIdentity.values()];
  const reachable = new Set(holdings.filter((h) => h.isFund).map((h) => h.id));
  for (let depth = 0; depth < 12; depth++)
    for (const s of fundSnapshots.filter((s) => reachable.has(s.fundId)))
      for (const h of s.holdings.filter((h) => h.isFund)) reachable.add(h.id);
  fundSnapshots = fundSnapshots.filter((s) => reachable.has(s.fundId));
  const portfolios: InvestmentPortfolio[] = scope.map((p) => {
    const broker = brokerById.get(p.id);
    const snapshot = latestSnapshot(broker?.data);
    const summary = summaries.get(p.id)!;
    const positions = holdings.flatMap((h) => h.accounts.filter((a) => a.portfolioId === p.id));
    const cash =
      summary.cashKnown === false
        ? null
        : summary.currencyCode === currencyCode
          ? summary.totalCashInBaseCurrency
          : sum(balances.filter((b) => b.portfolioId === p.id).map((b) => decimal(b.refTotalCash)));
    const securitiesValue = sum(positions.map((a) => a.marketValue));
    const priced = positions.filter((a) => a.marketValue !== null);
    const knownBasis = priced.filter((a) => a.costBasis !== null);
    const pricedValue = sum(priced.map((a) => a.marketValue))!;
    const gainValue = sum(knownBasis.map((a) => a.marketValue))!;
    const gainBasis = sum(knownBasis.map((a) => a.costBasis))!;
    const accountTransfers = transfers.filter((t) => t.toPortfolioId === p.id || t.fromPortfolioId === p.id);
    const recordedFunding = accountTransfers.length
      ? sum(accountTransfers.map((t) => nativeExternalFlow(t, new Set([p.id]))))
      : positions.length
        ? null
        : '0';
    const missing = holdings.flatMap((h) =>
      h.accounts
        .filter((a) => a.portfolioId === p.id)
        .flatMap((a) => [
          ...(a.marketValue === null ? [`${h.symbol}: price missing`] : []),
          ...(a.costBasis === null ? [`${h.symbol}: cost basis missing`] : []),
        ]),
    );
    if (cash === null) missing.push('Cash balance: import a current account statement.');
    if (recordedFunding === null || (broker && !broker.data.historyComplete))
      missing.push('Lifetime funding: reconcile deposits, withdrawals and opening balance with broker history.');
    return {
      calculation: {
        securitiesValue,
        pricedValue,
        gainValue,
        gainBasis,
        unrealizedGain: knownBasis.length
          ? sum(knownBasis.map((a) => a.unrealizedGain))
          : positions.length
            ? null
            : '0',
        recordedFunding,
        holdingsLessRecordedFunding:
          securitiesValue !== null && recordedFunding !== null
            ? new Big(securitiesValue).minus(recordedFunding).toString()
            : null,
        accountGain:
          securitiesValue !== null &&
          cash !== null &&
          recordedFunding !== null &&
          (!broker || broker.data.historyComplete)
            ? new Big(securitiesValue).plus(cash).minus(recordedFunding).toString()
            : null,
        missing,
      },
      id: p.id,
      name: p.name,
      broker: broker?.data.broker ?? 'Other',
      accountType: /\broth\b/i.test(p.name)
        ? 'Roth'
        : /\b(traditional|rollover)\b/i.test(p.name)
          ? 'Traditional retirement'
          : p.portfolioType,
      isEnabled: p.isEnabled,
      historyComplete: broker ? broker.data.historyComplete : true,
      currencyCode,
      marketValue:
        summary.marketValueKnown === false || securitiesValue === null || cash === null
          ? null
          : summary.totalPortfolioValueInBaseCurrency,
      cash,
      costBasis: sum(positions.map((a) => a.costBasis)),
      unrealizedGain: sum(positions.map((a) => a.unrealizedGain)),
      realizedGain:
        summary.realizedGainKnown === false
          ? null
          : summary.currencyCode === currencyCode
            ? summary.realizedGainValue
            : sum(
                allHoldingValues
                  .filter((v) => v.portfolioId === p.id)
                  .map((v) =>
                    v.realizedGainKnown === false || (v.currencyCode !== currencyCode && v.baseRate === undefined)
                      ? null
                      : new Big(v.realizedGainValue ?? 0)
                          .times(v.currencyCode === currencyCode ? 1 : v.baseRate!)
                          .toString(),
                  ),
              ),
      observationDate: snapshot?.asOf ?? null,
      review: broker?.data.review ?? [],
    };
  });
  const completeHistory = portfolios.every((p) => p.historyComplete);
  const securitiesValue = sum(holdings.map((h) => h.marketValue));
  const cashValue = sum(portfolios.map((p) => p.cash));
  const marketValue = sum(portfolios.map((p) => p.marketValue));
  const costBasis = sum(holdings.map((h) => h.costBasis));
  const unrealizedGain =
    securitiesValue !== null && costBasis !== null ? new Big(securitiesValue).minus(costBasis).toString() : null;
  const realizedGain = completeHistory ? sum(portfolios.map((p) => p.realizedGain)) : null;
  const metrics: Record<string, InvestmentMetric> = {
    accountGain: metric(
      sum(portfolios.map((p) => p.calculation!.accountGain)),
      portfolios
        .filter((p) => p.calculation!.accountGain === null)
        .map((p) => `${p.name}: ${p.calculation!.missing.filter((m) => !m.includes('cost basis')).join(' ')}`)
        .join('\n') || undefined,
    ),
    marketValue: metric(
      marketValue,
      marketValue === null ? 'One or more positions or cash balances are unavailable.' : undefined,
    ),
    securitiesValue: metric(securitiesValue),
    cash: metric(cashValue),
    costBasis: metric(costBasis, costBasis === null ? 'Open-position basis is incomplete.' : undefined),
    unrealizedGain: metric(unrealizedGain),
    unrealizedPercent: metric(percent(unrealizedGain, costBasis)),
    realizedGain: metric(
      realizedGain,
      realizedGain === null ? 'Complete opening positions and sale history are required.' : undefined,
    ),
    combinedGain: metric(sum([unrealizedGain, realizedGain])),
  };
  const knownSecurities = sum(holdings.filter((h) => h.marketValue !== null).map((h) => h.marketValue))!;
  const knownCash = sum(portfolios.filter((p) => p.cash !== null).map((p) => p.cash))!;
  metrics.knownSecuritiesValue = {
    value: knownSecurities,
    status: securitiesValue === null ? 'partial' : 'verified',
    ...(securitiesValue === null && { reason: 'Subtotal of priced positions only; unpriced positions are excluded.' }),
  };
  metrics.knownCash = {
    value: knownCash,
    status: cashValue === null ? 'partial' : 'verified',
    ...(cashValue === null && {
      reason: 'Subtotal of evidenced investment cash only; unknown cash balances are excluded.',
    }),
  };
  metrics.knownMarketValue = {
    value: new Big(knownSecurities).plus(knownCash).toString(),
    status: marketValue === null ? 'partial' : 'verified',
    ...(marketValue === null && {
      reason:
        'Known priced holdings plus evidenced cash. This is a partial subtotal, not the full selected investment value.',
    }),
  };
  metrics.unknownPositionCount = metric(String(holdings.filter((h) => h.marketValue === null).length));
  metrics.unknownCashCount = metric(String(portfolios.filter((p) => p.cash === null).length));
  const knownBasisAccounts = holdings
    .flatMap((h) => h.accounts)
    .filter((a) => a.costBasis !== null && a.marketValue !== null);
  metrics.knownCostBasis = {
    value: knownBasisAccounts.length ? sum(knownBasisAccounts.map((a) => a.costBasis)) : null,
    status: costBasis === null ? 'partial' : 'verified',
    reason: 'Recorded open-position basis only; positions without evidenced basis are excluded.',
  };
  metrics.knownUnrealizedGain = {
    value: knownBasisAccounts.length ? sum(knownBasisAccounts.map((a) => a.unrealizedGain)) : null,
    status: unrealizedGain === null ? 'partial' : 'verified',
    reason: 'Native unrealized gains for positions with known basis and value; missing positions are excluded.',
  };
  const reportedRealized = brokers.flatMap((b) => b.data.taxReports.filter((r) => r.realizedGain !== null));
  metrics.reportedRealizedGain = {
    value: reportedRealized.length ? sum(reportedRealized.map((r) => r.realizedGain)) : null,
    status: 'partial',
    reason: `Broker-reported realized gains for tax years ${[...new Set(reportedRealized.map((r) => r.year))].sort().join(', ') || 'unavailable'}. Other periods are incomplete.`,
  };
  const flows = transfers.map((t) => ({
    date: t.date,
    value: nativeExternalFlow(t, selected),
    portfolioId: t.toPortfolioId ?? t.fromPortfolioId!,
  }));
  const contributions = sum(flows.filter((f) => new Big(f.value).gt(0)).map((f) => f.value))!;
  const withdrawals = sum(flows.filter((f) => new Big(f.value).lt(0)).map((f) => new Big(f.value).neg().toString()))!;
  metrics.knownNetInvested = {
    value: transfers.length ? new Big(contributions).minus(withdrawals).toString() : null,
    status: completeHistory ? 'verified' : 'partial',
    reason:
      'Recorded deposits less withdrawals only. Import missing funding and opening balances to reconcile lifetime invested capital.',
  };
  for (const [key, value] of Object.entries({
    contributions,
    withdrawals,
    netInvested: new Big(contributions).minus(withdrawals).toString(),
  }))
    metrics[key] = {
      value: completeHistory ? value : null,
      status: completeHistory ? 'verified' : 'unavailable',
      ...(!completeHistory && {
        reason: 'Imported funding history is incomplete; recorded flows are shown separately.',
      }),
    };
  const dividends: InvestmentAnalytics['dividends'] = transactions
    .filter((t) => t.category === 'dividend')
    .map((t) => ({
      id: t.id,
      date: new Date(t.date).toISOString().slice(0, 10),
      portfolioId: t.portfolioId,
      portfolioName: portfolioById.get(t.portfolioId)?.name ?? 'Portfolio',
      securityId: t.securityId,
      symbol: t.security?.symbol ?? '',
      name: t.security?.name ?? '',
      amount: decimal(t.refAmount),
      currencyCode,
      status: 'recorded',
      reinvested: null,
      type: 'dividend',
    }));
  metrics.dividends = {
    value: sum(dividends.map((d) => d.amount)),
    status: completeHistory ? 'verified' : 'partial',
    ...(!completeHistory && { reason: 'Recorded distributions only; imported history is incomplete.' }),
  };
  metrics.dividendsYtd = {
    ...metrics.dividends,
    value: sum(dividends.filter((d) => d.date.startsWith(today.slice(0, 4))).map((d) => d.amount)),
  };
  metrics.dividendsMonth = {
    ...metrics.dividends,
    value: sum(dividends.filter((d) => d.date.startsWith(today.slice(0, 7))).map((d) => d.amount)),
  };
  metrics.interest = metric(null, 'Native investment records do not distinguish a verified interest category.');
  metrics.fees = {
    value: sum(transactions.map((t) => decimal(t.category === 'fee' ? t.refAmount : t.refFees))),
    status: completeHistory ? 'verified' : 'partial',
    reason: 'Recorded trade fees and standalone fee charges; source history may omit other account charges.',
  };
  const dailyCapital = new Map<string, string>();
  for (const h of holdings) {
    const nativeBasis = sum(
      allHoldingValues
        .filter((v) => v.securityId === h.securityId)
        .map((v) => (v.costBasisKnown === false ? null : v.costBasis)),
    );
    h.averageCost =
      nativeBasis !== null && new Big(h.quantity).gt(0) ? new Big(nativeBasis).div(h.quantity).toString() : null;
    h.unrealizedGain =
      h.marketValue !== null && h.costBasis !== null ? new Big(h.marketValue).minus(h.costBasis).toString() : null;
    h.unrealizedPercent = percent(h.unrealizedGain, h.costBasis);
    h.weight = percent(h.marketValue, marketValue ?? new Big(knownSecurities).plus(knownCash).toString());
    h.dividends = sum(dividends.filter((d) => d.securityId === h.securityId).map((d) => d.amount));
    const series = pricesBySecurity.get(h.securityId) ?? [];
    h.periodReturns = recordedPriceReturns(
      series.map((p) => ({ date: new Date(p.date).toISOString(), price: decimal(p.priceClose) })),
    );
    const latest = series.at(-1);
    let sessionDate = easternDate();
    while (!usEquitySession(sessionDate).tradingDay) {
      const prior = new Date(sessionDate + 'T12:00:00Z');
      prior.setUTCDate(prior.getUTCDate() - 1);
      sessionDate = prior.toISOString().slice(0, 10);
    }
    const previous = latest
      ? series.findLast(
          (p) => investmentPriceDate(p.priceAsOf ?? p.date, p.priceAsOf ? false : undefined) < sessionDate,
        )
      : undefined;
    const priorReference = latest?.previousClose;
    const reference = priorReference
      ? { date: new Date(priorReference.date), price: new Big(priorReference.price) }
      : previous
        ? { date: new Date(previous.date), price: new Big(decimal(previous.priceClose)) }
        : undefined;
    const freshPair =
      latest &&
      reference &&
      Date.now() - new Date(latest.date).getTime() <= 4 * 86400000 &&
      new Date(latest.date).getTime() - reference.date.getTime() <= 4 * 86400000;
    if (
      latest &&
      reference &&
      freshPair &&
      h.currencyCode === currencyCode &&
      h.priceDate &&
      investmentPriceDate(h.priceDate) === sessionDate &&
      investmentPriceDate(latest.date) === sessionDate
    ) {
      const dayTrades = transactions.filter(
        (t) =>
          t.securityId === h.securityId &&
          investmentPriceDate(t.date) === sessionDate &&
          (t.category === 'buy' || t.category === 'sell'),
      );
      const daily =
        h.marketValue === null
          ? null
          : dailyPositionChange({
              quantity: h.quantity,
              marketValue: h.marketValue,
              previousClose: reference.price.toString(),
              trades: dayTrades.map((t) => ({
                category: t.category,
                quantity: decimal(t.quantity),
                amount: decimal(t.refAmount),
              })),
            });
      h.dailyChange = daily?.change ?? null;
      for (const a of h.accounts) {
        a.dailyChange =
          a.marketValue === null
            ? null
            : (dailyPositionChange({
                quantity: a.quantity,
                marketValue: a.marketValue,
                previousClose: reference.price.toString(),
                trades: dayTrades
                  .filter((t) => t.portfolioId === a.portfolioId)
                  .map((t) => ({ category: t.category, quantity: decimal(t.quantity), amount: decimal(t.refAmount) })),
              })?.change ?? null);
      }
      h.dailyChangePercent = daily?.percent ?? null;
      if (daily) dailyCapital.set(h.id, daily.capital);
      h.previousCloseDate = dateString(reference.date);
      h.dailyChangeReason = h.accounts.some((a) => !portfolios.find((p) => p.id === a.portfolioId)?.historyComplete)
        ? 'Current shares and recorded same-session trades versus the previous recorded close; imported trade history is partial.'
        : 'Previous recorded close with same-session buys, sells and fees removed from the change in position value.';
    }
    if (h.dailyChange === null) {
      const quoteDay = h.priceDate
        ? investmentPriceDate(h.priceDate, h.assetClass === 'crypto' ? false : undefined)
        : null;
      h.dailyChangeReason = !quoteDay
        ? `${h.symbol}: no stored quote. Refresh prices or verify its provider ticker.`
        : quoteDay !== sessionDate
          ? `${h.symbol}: latest quote is dated ${quoteDay}; this comparison uses the ${sessionDate} US session. Select matching dates in price history.`
          : !reference || !freshPair
            ? `${h.symbol}: a matching previous-session close is missing. Refresh historical prices.`
            : h.marketValue === null
              ? `${h.symbol}: a position value or currency conversion is missing. Check the account's dated holdings and currency records.`
              : `${h.symbol}: opening shares do not reconcile with recorded session trades. Import missing trades or corporate-action records.`;
    }
    h.quoteStatus = !h.priceDate
      ? 'unavailable'
      : investmentPriceDate(h.priceDate) !== sessionDate
        ? 'historical'
        : !usEquityMarketOpen()
          ? 'closing'
          : 'delayed';
    const stale = !h.priceDate || new Date(h.priceDate).getTime() < Date.now() - 4 * 86400000;
    health.push({
      id: `price:${h.id}`,
      securityId: h.securityId,
      label: `${h.symbol} price`,
      status: !h.priceDate ? 'unavailable' : stale ? 'stale' : 'verified',
      detail: `${h.accounts[0]?.source ?? 'Unknown source'} · price observation`,
      asOf: h.priceDate,
    });
    if (h.costBasis === null)
      health.push({
        id: `basis:${h.id}`,
        securityId: h.securityId,
        label: `${h.symbol} cost basis`,
        status: 'unavailable',
        detail: 'Opening lots or broker basis evidence are incomplete.',
      });
  }
  const dailyHoldings = holdings.filter((h) => h.dailyChange !== null);
  // Fully exited native positions still contribute their same-session trading gain.
  // They remain absent from the current holdings and allocation views.
  const closedChanges: { change: string; capital: string }[] = [];
  const activeIds = new Set(holdings.map((h) => h.id));
  let currentSession = easternDate();
  while (!usEquitySession(currentSession).tradingDay) {
    const prior = new Date(currentSession + 'T12:00:00Z');
    prior.setUTCDate(prior.getUTCDate() - 1);
    currentSession = prior.toISOString().slice(0, 10);
  }
  for (const id of new Set(
    allHoldingValues
      .filter((h) => !activeIds.has(h.securityId) && h.currencyCode === currencyCode)
      .map((h) => h.securityId),
  )) {
    const trades = transactions.filter(
      (t) =>
        t.securityId === id &&
        investmentPriceDate(t.date) === currentSession &&
        (t.category === 'buy' || t.category === 'sell'),
    );
    if (!trades.length) continue;
    const previous = pricesBySecurity.get(id)?.findLast((p) => investmentPriceDate(p.date) < currentSession);
    if (!previous || Date.now() - new Date(previous.date).getTime() > 5 * 86400000) continue;
    const daily = dailyPositionChange({
      quantity: '0',
      marketValue: '0',
      previousClose: decimal(previous.priceClose),
      trades: trades.map((t) => ({
        category: t.category,
        quantity: decimal(t.quantity),
        amount: decimal(t.refAmount),
      })),
    });
    if (daily) closedChanges.push(daily);
  }
  metrics.dailyChange = {
    value:
      dailyHoldings.length || closedChanges.length
        ? sum([...dailyHoldings.map((h) => h.dailyChange), ...closedChanges.map((h) => h.change)])
        : null,
    status: dailyHoldings.length === holdings.length && completeHistory ? 'verified' : 'partial',
    reason: `${dailyHoldings.length}/${holdings.length} active positions with current-session quotes and a prior close; ${closedChanges.length} recorded same-session exits. Recorded net buys, sells and fees are accounted for; incomplete trade history and missing quotes limit coverage.`,
  };
  metrics.dailyChangePercent = metric(
    metrics.dailyChange.value !== null
      ? percent(
          metrics.dailyChange.value,
          sum([...dailyHoldings.map((h) => dailyCapital.get(h.id) ?? null), ...closedChanges.map((h) => h.capital)]),
        )
      : null,
  );
  metrics.dailyChangePercent.status = metrics.dailyChange.status;
  metrics.dailyChangePercent.reason =
    'Change relative to the covered positions’ previous-close value, adjusted for recorded trades; cash and uncovered positions are excluded.';
  if (performanceFrom && performanceThrough && (performanceFrom > performanceThrough || performanceThrough > today))
    throw new ValidationError({ message: 'Choose a date range through today or earlier.' });
  const periodDates = {
    ...positionPeriodDates(today),
    ...(performanceFrom && performanceThrough
      ? { custom: performanceFrom === performanceThrough ? previousUsEquitySession(performanceFrom) : performanceFrom }
      : {}),
  };
  const baselineDays = new Set(Object.values(periodDates));
  if (performanceThrough) baselineDays.add(performanceThrough);
  const positionBaselines = new Map<string, string>();
  const positionQuantities = new Map<string, string>();
  const shareUnitFactor = createShareUnitFactor(prices, investmentPriceDate);
  const history = buildHistory({
    onHoldingValue: (row) => {
      if (baselineDays.has(row.date)) {
        positionBaselines.set(`${row.portfolioId}:${row.securityId}:${row.date}`, String(row.value));
        positionQuantities.set(`${row.portfolioId}:${row.securityId}:${row.date}`, String(row.quantity));
      }
    },
    ids,
    currencyCode,
    brokers,
    transfers,
    balances,
    securities,
    prices,
    transactions: transactions.map((t) => ({
      portfolioId: t.portfolioId,
      securityId: t.securityId,
      category: t.category,
      date: t.date,
      quantity: decimal(t.quantity),
      refAmount: decimal(t.refAmount),
      currencyCode: t.currencyCode,
      settlementAmount: decimal(t.settlementAmount),
      settlementCurrencyCode: t.settlementCurrencyCode,
    })) as TransactionRow[],
  });
  const supportedFrom = new Map<string, string | undefined>(
    scope.map((p) => {
      const broker = brokerById.get(p.id);
      const first =
        broker?.data.historyComplete !== false
          ? transactions
              .find((t) => t.portfolioId === p.id)
              ?.date.toISOString()
              .slice(0, 10)
          : broker?.data.snapshots
              .filter((s) => s.complete && s.positions?.length)
              .map((s) => investmentPriceDate(s.asOf))
              .sort()[0];
      return [p.id, first];
    }),
  );
  for (const h of holdings)
    h.personalReturns = positionPeriodReturns({
      holding: h,
      dates: periodDates,
      through: performanceThrough && performanceThrough < today ? performanceThrough : undefined,
      shareUnitFactor,
      positionQuantity: (portfolioId, securityId, date) =>
        positionQuantities.get(`${portfolioId}:${securityId}:${date}`) ?? null,
      openingValue: (portfolioId, securityId, date) => {
        const first = supportedFrom.get(portfolioId);
        const day = history.find((p) => p.date === date);
        if (!first || first > date || day?.knownPortfolios?.[portfolioId] == null) return null;
        return positionBaselines.get(`${portfolioId}:${securityId}:${date}`) ?? '0';
      },
      trades: transactions.map((t) => ({
        portfolioId: t.portfolioId,
        securityId: t.securityId,
        date: investmentPriceDate(t.date),
        category: t.category,
        amount: decimal(t.refAmount),
        quantity: decimal(t.quantity),
      })),
    });
  const currentPoint = history.find((p) => p.date === today);
  if (currentPoint) {
    currentPoint.knownPortfolios = Object.fromEntries(
      portfolios.map((p) => {
        const accounts = holdings.flatMap((h) => h.accounts).filter((a) => a.portfolioId === p.id);
        return [
          p.id,
          p.marketValue ??
            sum([...accounts.filter((a) => a.marketValue !== null).map((a) => a.marketValue), p.cash ?? '0']),
        ];
      }),
    );
    currentPoint.knownMarketValue = metrics.knownMarketValue.value;
    currentPoint.marketValue = marketValue;
    currentPoint.source =
      'Current native positions at their actual latest quote times; unknown cash excluded from known subtotals';
  }
  const noFlows = flows.every((f) => new Big(f.value).eq(0));
  const exactPoints = history.filter(
    (p) =>
      p.marketValue !== null &&
      portfolios.every((portfolio) =>
        brokerById.get(portfolio.id)?.data.snapshots.some((s) => s.complete && investmentPriceDate(s.asOf) === p.date),
      ),
  );
  const returns = consolidatedReturns(
    exactPoints.map((p) => ({ date: p.date, beforeFlow: p.marketValue, afterFlow: p.marketValue, externalFlow: '0' })),
    completeHistory && noFlows,
  );
  for (const [key, value] of Object.entries({
    twr: returns.twr,
    xirr: returns.xirr,
    annualizedReturn: returns.annualized,
    lifetimeReturn: returns.twr,
    volatility: returns.volatility,
    maxDrawdown: returns.maxDrawdown,
  }))
    metrics[key] = metric(
      value,
      value === null
        ? 'Exact historical valuations at cash-flow boundaries and complete funding history are required. Native approximated history is not substituted.'
        : undefined,
    );
  metrics.ytdReturn = metric(null, 'Verified year-opening value and cash-flow boundary valuations are required.');
  if (returns.twr !== null)
    for (const p of exactPoints)
      p.returnPercent = percent(
        new Big(p.marketValue!).minus(exactPoints[0]!.marketValue!).toString(),
        exactPoints[0]!.marketValue!,
      );
  const allocationValue = marketValue ?? new Big(knownSecurities).plus(knownCash).toString();
  const exposure = lookThrough(holdings, fundSnapshots, allocationValue);
  fillMissingCompanyClassifications(exposure.filter(isCompanyExposure), securities);
  fillMissingCompanyClassifications(
    holdings.filter((h) => !h.isFund && h.assetClass === 'stocks'),
    securities,
  );
  const fundValue = sum(holdings.filter((h) => h.isFund).map((h) => h.marketValue));
  const coveredFundValue = sum(
    holdings
      .filter((h) => h.isFund)
      .map((h) => {
        if (h.marketValue === null) return null;
        const snapshot = fundSnapshots.find((s) => s.fundId === h.id);
        return new Big(h.marketValue)
          .times(snapshot?.coverage ?? '0')
          .div(100)
          .toString();
      }),
  );
  const lookThroughCoverage = percent(coveredFundValue, fundValue) ?? '0';
  metrics.lookThroughCoverage = metric(lookThroughCoverage);
  const rankedExposure = exposure.filter(isCompanyExposure).sort((a, b) => new Big(b.totalValue).cmp(a.totalValue));
  metrics.topFiveConcentration = metric(
    percent(sum(rankedExposure.slice(0, 5).map((e) => e.totalValue)), allocationValue),
  );
  metrics.topTenConcentration = metric(
    percent(sum(rankedExposure.slice(0, 10).map((e) => e.totalValue)), allocationValue),
  );
  if (marketValue === null || exposure.some((e) => e.unknown))
    for (const key of ['topFiveConcentration', 'topTenConcentration'])
      if (metrics[key]!.value !== null)
        metrics[key] = {
          ...metrics[key]!,
          status: 'partial',
          reason:
            'Percent of known investment assets. Unidentified fund exposure and unknown cash are excluded; they may change concentration.',
        };
  const allocations: InvestmentAnalytics['allocations'] = {};
  allocations.holdings = allocation(
    holdings.map((h) => ({ key: h.id, label: h.symbol, value: h.marketValue, id: h.id })),
    allocationValue,
  );
  if (new Big(knownCash).gt(0))
    allocations.holdings.push({
      key: 'cash',
      label: 'Investment cash',
      value: knownCash,
      percent: percent(knownCash, allocationValue),
      securityIds: [],
    });
  const nonCompanyValue = sum([
    ...exposure.filter((e) => !e.unknown && !isCompanyExposure(e)).map((e) => e.totalValue),
    knownCash,
  ])!;
  metrics.nonCompanyValue = metric(nonCompanyValue);
  metrics.nonCompanyWeight = metric(percent(nonCompanyValue, allocationValue));
  allocations.underlying = allocation(
    [
      ...exposure
        .filter((e) => e.unknown || isCompanyExposure(e))
        .map((e) => ({ key: e.id, label: e.unknown ? e.name : e.symbol, value: e.totalValue, id: e.id })),
      ...(new Big(nonCompanyValue).eq(0)
        ? []
        : [{ key: 'non-company', label: 'Non-company assets', value: nonCompanyValue, id: 'non-company' }]),
    ],
    allocationValue,
  );
  for (const mode of ['sector', 'industry', 'country', 'region', 'marketCap', 'style', 'assetClass'] as const)
    allocations[mode] = allocation(
      exposure.map((e) => {
        const label =
          mode !== 'assetClass' && !e.unknown && !isCompanyExposure(e)
            ? 'Non-company assets'
            : mode === 'country'
              ? (investmentIssuerCountry(e.country) ?? 'Unknown')
              : (e[mode] ?? 'Unknown');
        return { key: label, label, value: e.totalValue, id: e.id };
      }),
      allocationValue,
    );
  allocations.usInternational = allocation(
    exposure.map((e) => {
      const label =
        !e.unknown && !isCompanyExposure(e)
          ? 'Non-company assets'
          : !investmentIssuerCountry(e.country)
            ? 'Unknown'
            : investmentIssuerCountry(e.country) === 'US'
              ? 'US'
              : 'International';
      return { key: label, label, value: e.totalValue, id: e.id };
    }),
    allocationValue,
  );
  allocations.development = allocation(
    exposure.map((e) => ({
      key: !e.unknown && !isCompanyExposure(e) ? 'Non-company assets' : (e.market ?? 'Unknown'),
      label: !e.unknown && !isCompanyExposure(e) ? 'Non-company assets' : (e.market ?? 'Unknown'),
      value: e.totalValue,
      id: e.id,
    })),
    allocationValue,
  );
  if (new Big(knownCash).gt(0)) {
    for (const mode of [
      'sector',
      'industry',
      'country',
      'region',
      'marketCap',
      'style',
      'usInternational',
      'development',
      'assetClass',
    ]) {
      const key = mode === 'assetClass' ? 'Cash' : 'Non-company assets';
      const row = allocations[mode]?.find((r) => r.key === key);
      if (row) {
        row.value = new Big(row.value ?? 0).plus(knownCash).toString();
        row.percent = percent(row.value, allocationValue);
      } else
        allocations[mode]?.push({
          key,
          label: key,
          value: knownCash,
          percent: percent(knownCash, allocationValue),
          securityIds: [],
        });
    }
  }
  for (const mode of ['brokerage', 'accountType'] as const)
    allocations[mode] = allocation(
      portfolios.map((p) => ({
        key: mode === 'brokerage' ? p.broker : p.accountType,
        label: mode === 'brokerage' ? p.broker : p.accountType,
        value:
          p.marketValue ??
          sum([
            ...holdings
              .flatMap((h) => h.accounts)
              .filter((a) => a.portfolioId === p.id && a.marketValue !== null)
              .map((a) => a.marketValue),
            p.cash ?? '0',
          ]),
        id: p.id,
      })),
      allocationValue,
    );
  for (const p of portfolios) {
    health.push({
      id: `history:${p.id}`,
      portfolioId: p.id,
      label: `${p.name} history`,
      status: p.historyComplete ? 'verified' : 'partial',
      detail: p.historyComplete
        ? 'Native transaction history is available; historical replay may use documented approximations.'
        : 'Opening positions, funding or corporate-action coverage is incomplete; returns are withheld.',
      asOf: p.observationDate,
    });
    const snap = latestSnapshot(brokerById.get(p.id)?.data);
    if (snap?.totalValue != null && p.marketValue !== null) {
      const difference = new Big(p.marketValue).minus(snap.totalValue);
      health.push({
        id: `reconciliation:${p.id}`,
        portfolioId: p.id,
        label: `${p.name} source reconciliation`,
        status: difference.abs().lte('0.02') ? 'verified' : 'partial',
        detail: `Current computed value versus dated broker total: ${difference.toFixed(2)} ${currencyCode}. Newer prices may explain a difference.`,
        asOf: snap.asOf,
      });
    }
    for (let i = 0; i < p.review.length; i++)
      health.push({
        id: `review:${p.id}:${i}`,
        portfolioId: p.id,
        label: `${p.name} review`,
        status: 'partial',
        detail: p.review[i]!,
      });
  }
  for (const h of holdings.filter((h) => h.isFund)) {
    const snap = fundSnapshots.find((s) => s.fundId === h.id);
    health.push({
      id: `fund:${h.id}`,
      securityId: h.id,
      label: `${h.symbol} fund holdings`,
      status: !snap
        ? 'unavailable'
        : new Big(snap.coverage).lt(100)
          ? 'partial'
          : Date.now() - new Date(snap.asOf).getTime() > 120 * 86400000
            ? 'stale'
            : 'verified',
      detail: snap
        ? `${snap.coverage}% reported · ${snap.provider} · ${snap.classificationStandard ?? 'Unspecified classification standard'}`
        : 'No permitted composition provider is connected. Import a dated issuer CSV or JSON composition.',
      asOf: snap?.asOf,
    });
    if (!snap)
      health.push({
        id: `fund-classification:${h.id}`,
        securityId: h.id,
        label: `${h.symbol} instrument classification`,
        status: 'partial',
        detail:
          'Fund classification inferred from an explicit ETF, fund or fund-issuer name. Confirm using a dated source composition.',
      });
  }
  const priceRisk = currentHoldingsPriceRisk(
    holdings,
    prices.map((p) => ({
      securityId: p.securityId,
      date: new Date(p.date).toISOString(),
      price: decimal(p.priceClose),
    })),
    currencyCode,
  );
  const benchmarks: InvestmentBenchmark[] = benchmarkSymbols.map((symbol) => {
    const security = benchmarksSecurities.find((s) => s.symbol === symbol);
    const points = security
      ? (pricesBySecurity.get(security.id) ?? []).map((p) => ({
          date: new Date(p.date).toISOString().slice(0, 10),
          value: decimal(p.priceClose),
        }))
      : [];
    const normalized = normalizeComparableSeries([{ id: symbol, points }])[0]?.points ?? [];
    return {
      id: security?.id ?? symbol,
      symbol,
      name: security?.name ?? symbol,
      returnType: 'price-only',
      status: normalized.length > 1 ? 'verified' : 'unavailable',
      points: normalized,
      ...(normalized.length <= 1 && {
        reason: !points.length
          ? 'No stored price history for this benchmark. Add it through existing security management and price refresh.'
          : 'At least two stored price observations are required.',
      }),
    };
  });
  const events: InvestmentAnalytics['events'] = [
    ...transactions
      .filter((t) => ['buy', 'sell', 'dividend'].includes(t.category))
      .map((t) => ({
        id: t.id,
        date: new Date(t.date).toISOString().slice(0, 10),
        type: t.category,
        label: `${t.category} · ${t.security?.symbol ?? ''}`,
        amount: decimal(t.refAmount),
        portfolioId: t.portfolioId,
        securityId: t.securityId,
        symbol: t.security?.symbol ?? '',
      })),
    ...flows
      .filter((f) => !new Big(f.value).eq(0))
      .map((f, i) => ({
        id: `flow:${i}:${f.date}`,
        date: f.date,
        type: new Big(f.value).gt(0) ? 'contribution' : 'withdrawal',
        label: new Big(f.value).gt(0) ? 'Contribution' : 'Withdrawal',
        amount: f.value,
        portfolioId: f.portfolioId,
      })),
  ];
  const pricedValue = sum(holdings.filter((h) => h.marketValue !== null).map((h) => h.marketValue))!;
  const knownBasisValue = sum(
    holdings.filter((h) => h.costBasis !== null && h.marketValue !== null).map((h) => h.marketValue),
  )!;
  // MAX includes genuine partial observations/events even when selected portfolios
  // have no common fully valued date. Missing aggregate values remain null.
  const dates = history.map((p) => p.date);
  const syncDates = securities
    .map((s) => dateString(s.pricingLastSyncedAt))
    .filter((s): s is string => !!s)
    .sort();
  for (const p of portfolios) {
    const knownDaily = holdings.flatMap((h) =>
      h.accounts.filter((a) => a.portfolioId === p.id && a.dailyChange != null),
    );
    p.calculation!.dailyChange = knownDaily.length ? sum(knownDaily.map((a) => a.dailyChange!)) : null;
  }
  const result: InvestmentAnalytics = {
    generatedAt: new Date().toISOString(),
    priceRisk,
    currencyCode,
    selectedPortfolioIds: ids,
    portfolios,
    metrics,
    holdings,
    history,
    dividends,
    events,
    exposure,
    allocations,
    fundSnapshots,
    composition: compositionStatuses(
      holdings.filter((h) => h.isFund),
      fundSnapshots,
      await getCompositionAttempts(userId),
      (await getCompositionSchedule(userId))?.enabled,
    ),
    overlap: fundOverlap(fundSnapshots, holdings, { includeDetails: !compact, pair: overlapPair }),
    benchmarks,
    health,
    coverage: {
      historyStart: dates[0] ?? null,
      historyEnd: dates.at(-1) ?? null,
      costBasisPercent: percent(knownBasisValue, pricedValue) ?? '0',
      pricePercent: holdings.length
        ? String((holdings.filter((h) => h.marketValue !== null).length / holdings.length) * 100)
        : '0',
      lookThroughPercent: lookThroughCoverage,
      fundCompositionPercent: lookThroughCoverage,
      fundValue,
      compositionDates: [...new Set(fundSnapshots.map((s) => s.asOf))].sort(),
      methodology: [
        'Current positions, basis and gains reuse the native portfolio calculation service.',
        'Historical values reuse native holdings/cash replay; its whole-dollar holding rounding remains unchanged. Missing price/FX fallbacks are withheld.',
        'Incomplete broker histories use actual complete dated observations only; unsupported periods remain gaps.',
        'Fund geography uses imported issuer country; exchange location and fund domicile are not substituted.',
        'Unknown fund weights remain unreported exposure; fund wrappers are excluded from underlying totals.',
        'Hidden portfolios are excluded from shared analytics, including explicit selections. Net-worth exclusion remains a separate setting.',
        'Reinvestment and interest attribution require explicit source evidence; unknown reinvestment is not labeled cash.',
      ],
    },
    refresh: {
      supported: true,
      lastSuccess: syncDates.at(-1) ?? null,
      provider: [...new Set(securities.map((s) => s.providerName))].join(', ') || 'Existing market providers',
      schedule:
        'Prices: approximately every 5 minutes during regular US sessions (09:30–16:00 Eastern; holidays and early closes respected). One stock closing check follows the session; daily historical reconciliation runs at 06:00 Eastern. Mutual funds publish daily NAV. Fund compositions use dated disclosures and separately enabled weekly SEC checks.',
      reason:
        'Refresh uses the existing price services with owner-scoped visible holdings and verified benchmarks. Broker transactions are synchronized separately.',
    },
  };
  return compact ? compactAnalytics(result) : result;
}

const deduplicatedAnalytics = withDeduplication(getAnalyticsImpl, {
  keyGenerator: ({
    userId,
    portfolioIds,
    benchmarkSymbols,
    hiddenPortfolioIds,
    compositionRevision,
    performanceFrom,
    performanceThrough,
    compact,
    overlapPair,
  }) =>
    `investment-analytics:${userId}:${portfolioIds?.toSorted().join(',') ?? 'all'}:${benchmarkSymbols?.join(',') ?? 'default'}:${hiddenPortfolioIds?.toSorted().join(',')}:${compositionRevision}:${performanceFrom}:${performanceThrough}:${compact}:${overlapPair?.join(',')}`,
  ttl: 1000,
  maxCacheSize: 8,
});
export async function getInvestmentAnalytics(
  args: Omit<Parameters<typeof getAnalyticsImpl>[0], 'hiddenPortfolioIds' | 'compositionRevision'>,
) {
  const [settings, revision] = await Promise.all([
    UserSettings.findOne({ where: { userId: args.userId } }),
    InvestmentFundSnapshots.findOne({
      where: { userId: args.userId },
      attributes: ['id', 'updatedAt'],
      order: [['updatedAt', 'DESC']],
    }),
  ]);
  return deduplicatedAnalytics({
    ...args,
    hiddenPortfolioIds: settings?.settings.ui?.hiddenPortfolioIds ?? [],
    compositionRevision: revision ? `${revision.id}:${new Date(revision.getDataValue('updatedAt')).toISOString()}` : '',
  });
}
