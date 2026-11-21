import type { InvestmentAnalytics, InvestmentPortfolio, InvestmentMetric } from '@bt/shared/types/investment-analytics';
import { easternDate, previousUsEquitySession } from '@bt/shared/types/investment-market';
import type { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { principalFor } from '@services/personal-finance/calculations';
import { matchPrincipalEvidence } from '@services/personal-finance/principal-matching';
import type { FinanceAccount, FinanceCashFlow } from '@services/personal-finance/types';
import Big from 'big.js';

import type { BrokerData } from '../broker-records/schema';
import { calculateCashDelta } from '../transactions/cash-balance-utils';
import type { AccountValuation } from './account-gain-sources';
import { percent } from './math';
import { verifiedFunding } from './verified-funding';

export const accountNameKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/fidelitly/g, 'fidelity')
    .replace(/broker records/g, '')
    .replace(/long\s*term/g, 'longterm')
    .replace(/investments?/g, 'invest')
    .replace(/\b(?:brokerage|ira|individual|account)\b/g, '')
    .replace(/\d+/g, '')
    .replace(/[^a-z]/g, '');
type Calculation = NonNullable<InvestmentPortfolio['calculation']>;
type FundingRecord = NonNullable<Calculation['fundingRecords']>[number];
export interface GainEvidence {
  accounts: FinanceAccount[];
  flows: FinanceCashFlow[];
  valuations: AccountValuation[];
}
export interface GainInput {
  brokers?: { portfolioId: string; data: BrokerData }[];
  operatingCash?: Map<string, FundingRecord[]>;
  portfolios: InvestmentPortfolio[];
  allPortfolioNames: string[];
  metrics: Record<string, InvestmentMetric>;
  sources: GainEvidence;
  today: string;
  funding: Map<string, FundingRecord[]>;
  trades: { portfolioId: string; category: string; amount: string; date?: string }[];
}
const total = (values: (string | null | undefined)[]) =>
  values.reduce<Big>((n, v) => (v == null ? n : n.plus(v)), new Big(0)).toString();
const valuationDate = (value: string) => (value.includes('T') ? easternDate(new Date(value)) : value);

/** Read-only reconciliation of existing principal, cash-flow and valuation evidence. */
export function reconcileAccountGains(input: GainInput): NonNullable<InvestmentAnalytics['accountValueAdjustments']> {
  const { portfolios, sources, today, metrics } = input;
  for (const p of portfolios) {
    const c = p.calculation!;
    const holdingAsOf = c.valueAsOf;
    const crypto = /crypto/i.test(p.name);
    const candidates = crypto
      ? []
      : sources.accounts.filter(
          (a) => a.currencyCode === p.currencyCode && accountNameKey(a.name) === accountNameKey(p.name),
        );
    const account = candidates.length === 1 ? candidates[0] : undefined;
    const flows = account
      ? sources.flows.filter((f) => f.accountId === account.id || f.toAccountId === account.id)
      : [];
    const principal = account ? principalFor(account.id, flows, today) : undefined;
    const records = (input.funding.get(p.id) ?? []).map((r) => ({ ...r }));
    // Only explicit source references deduplicate within one imported source.
    const seen = new Set<string>();
    for (const row of records) {
      const ref = /\[broker-row:([^\]]+)\]/.exec(row.description)?.[1];
      if (ref && seen.has(ref)) row.excluded = 'Duplicate source reference';
      if (ref) seen.add(ref);
    }
    const imported = records.filter((r) => !r.excluded);
    c.importedDeposits = total(imported.filter((r) => new Big(r.amount).gt(0)).map((r) => r.amount));
    c.importedWithdrawals = new Big(total(imported.filter((r) => new Big(r.amount).lt(0)).map((r) => r.amount)))
      .abs()
      .toString();
    const importedNet = new Big(c.importedDeposits).minus(c.importedWithdrawals).toString();
    const broker = input.brokers?.find((b) => b.portfolioId === p.id)?.data;
    const fundingVerified = verifiedFunding(broker, records, today);
    c.recordedFunding = imported.length ? importedNet : null;
    c.fundingRecords = records;
    c.principalRecords = flows.map((f) => ({
      id: f.id,
      date: f.date,
      amount: String(f.amount),
      type: f.opening ? 'opening principal' : f.type,
      description: f.description,
    }));
    c.financeAccountId = account?.id;
    c.principal = principal?.knownPrincipal == null ? c.recordedFunding : String(principal.knownPrincipal);
    if (fundingVerified) {
      c.worksheetPrincipal = principal?.knownPrincipal == null ? null : String(principal.knownPrincipal);
      c.principal = importedNet;
      c.principalRecords = imported.map((r) => ({
        id: r.id,
        date: r.date,
        amount: r.amount,
        type: new Big(r.amount).gte(0) ? 'deposit' : 'withdrawal / returned deposit',
        description: r.description,
      }));
    }
    c.principalSource = fundingVerified
      ? `Verified external funding · ${broker!.fundingCoverage!.from}–${broker!.fundingCoverage!.through}`
      : principal?.knownPrincipal != null
        ? 'Reconciled principal ledger'
        : 'Imported external flows (estimate)';
    c.principalDifference = c.principal == null ? null : new Big(c.principal).minus(importedNet).toString();
    // Linked Robinhood account spans stock + crypto; partition using provider account identity.
    const linked = account?.nativeAccountIds ?? [];
    const providerRows = sources.valuations
      .filter(
        (v) =>
          v.portfolioId === p.id ||
          (linked.includes(v.accountId) && /crypto/i.test(v.name) === crypto) ||
          (crypto && /robinhood/i.test(p.name) && /crypto/i.test(v.name)),
      )
      .filter((v) => v.date <= today);
    const latest = providerRows.at(-1);
    const cashObservation = providerRows.filter((v) => v.cash != null).at(-1);
    if (cashObservation?.cash != null) {
      // Advance a reported cash balance with native settlement signs, never purchases as deposits.
      const laterTrades = input.trades.filter((t) => t.portfolioId === p.id && t.date && t.date > cashObservation.date);
      const tradeCash = total(
        laterTrades.map((t) =>
          calculateCashDelta({ category: t.category as INVESTMENT_TRANSACTION_CATEGORY, settlementAmount: t.amount }),
        ),
      );
      const transfersAfter = [...imported, ...(input.operatingCash?.get(p.id) ?? [])].filter(
        (r) => r.date > cashObservation.date,
      );
      p.cash = new Big(cashObservation.cash)
        .plus(tradeCash)
        .plus(total(transfersAfter.map((r) => r.amount)))
        .toString();
      c.missing = c.missing.filter((m) => !m.startsWith('Cash balance:'));
    }
    // Public's linked bank account is cash-only; it is not its portfolio total.
    const cashOnly = latest && p.cash != null && new Big(latest.value).eq(p.cash) && new Big(c.pricedValue).gt(0);
    c.currentValue = p.marketValue ?? new Big(c.pricedValue).plus(p.cash ?? 0).toString();
    c.valueSource = p.marketValue == null ? 'Priced holdings + recorded cash' : 'Native portfolio valuation';
    c.valueAsOf = c.valueAsOf ?? p.observationDate ?? latest?.date ?? today;
    c.estimated =
      p.marketValue == null ||
      (!fundingVerified && (principal?.knownPrincipal == null || !!principal?.principalEstimated));
    const currentReported = latest && !cashOnly && latest.date >= valuationDate(c.valueAsOf);
    if (currentReported) {
      c.currentValue = latest.value;
      c.valueSource = latest.source || 'Reported account total';
      c.valueAsOf = latest.date;
      c.estimated = !fundingVerified && (principal?.knownPrincipal == null || !!principal?.principalEstimated);
      if (latest.cash != null) p.cash = latest.cash;
    }
    if (!currentReported && c.securitiesValue === null && new Big(c.pricedValue).eq(0) && p.cash === null) {
      c.currentValue = null;
      p.marketValue = null;
      c.accountGain = null;
      c.estimated = true;
      continue;
    }
    if (!c.principal && !new Big(c.currentValue).eq(0)) c.accountGain = null;
    else c.accountGain = new Big(c.currentValue).minus(c.principal ?? 0).toString();
    if (crypto) {
      const trades = input.trades.filter((t) => t.portfolioId === p.id);
      const purchases = total(trades.filter((t) => t.category === 'buy').map((t) => t.amount));
      const sales = total(trades.filter((t) => t.category === 'sell').map((t) => t.amount));
      const netTradingCapital = new Big(purchases).minus(sales).toString();
      c.purchaseCostEstimate = {
        purchases,
        sales,
        netTradingCapital,
        remainingBasis: p.costBasis,
        holdingGain: c.unrealizedGain,
      };
      c.principal = null;
      c.principalSource = 'No verified crypto cash deposits; trading-cost estimate shown separately';
      c.principalDifference = null;
      c.accountGain = trades.length ? new Big(c.currentValue).minus(netTradingCapital).toString() : c.unrealizedGain;
      c.estimated = true;
    }
    c.missing = c.missing.filter(
      (m) => !m.startsWith('Lifetime funding:') && !(m.startsWith('Cash balance:') && currentReported),
    );
    if (c.principal == null && !crypto && !new Big(c.currentValue).eq(0))
      c.missing.push('Lifetime principal: reconcile external deposits and withdrawals.');
    if (p.marketValue == null && !currentReported)
      c.missing = c.missing
        .filter((m) => !m.startsWith('Cash balance:'))
        .concat('Account value estimates holdings plus known cash; unrecorded cash is excluded.');
    p.marketValue = c.currentValue;
    const observation = broker?.accountObservations
      ?.filter((o) => o.date <= today && o.performance)
      .toSorted((a, b) => a.date.localeCompare(b.date))
      .at(-1);
    if (observation?.performance) {
      const trades = input.trades.filter((t) => t.portfolioId === p.id && (!t.date || t.date <= observation.date));
      const purchases = total(trades.filter((t) => t.category === 'buy').map((t) => t.amount));
      const sales = total(trades.filter((t) => t.category === 'sell').map((t) => t.amount));
      const dividends = total(trades.filter((t) => t.category === 'dividend').map((t) => t.amount));
      c.operatingCashRecords = (input.operatingCash?.get(p.id) ?? []).filter((r) => r.date <= observation.date);
      const operatingCash = total(c.operatingCashRecords.map((r) => r.amount));
      const netSecurityFlow = new Big(purchases).minus(sales).toString();
      const recordedPrincipal = total(imported.filter((r) => r.date <= observation.date).map((r) => r.amount));
      const observedPrincipal = fundingVerified
        ? recordedPrincipal
        : account
          ? principalFor(account.id, flows, observation.date).knownPrincipal
          : null;
      const bookCash = new Big(recordedPrincipal).minus(netSecurityFlow).plus(dividends).plus(operatingCash).toString();
      // Compare the reported values with each other, independently of later market quotes.
      const observedGain =
        observedPrincipal == null ? null : new Big(observation.totalValue).minus(observedPrincipal).toString();
      c.brokerReconciliation = {
        date: observation.date,
        source: observation.source,
        netContributions: observedPrincipal == null ? null : String(observedPrincipal),
        wholeAccountGain: observedGain,
        investmentsValue: observation.investmentsValue,
        reportedCash: observation.cash,
        reportedNetCashFlow: observation.performance.netCashFlow,
        reportedMarketGain: observation.performance.marketGain,
        reportedDividends: observation.performance.dividends,
        reportedTotalGain: observation.performance.totalGain,
        purchases,
        sales,
        dividends,
        operatingCash,
        bookCash,
        netSecurityFlow,
        cashDifference: new Big(observation.cash).minus(bookCash).toString(),
        dividendDifference: new Big(observation.performance.dividends).minus(dividends).toString(),
        securityFlowDifference: new Big(observation.performance.netCashFlow).minus(netSecurityFlow).toString(),
        gainDifference:
          observedGain == null ? null : new Big(observation.performance.totalGain).minus(observedGain).toString(),
      };
    }

    // Combine dated principal evidence and native transfers once, never checkpoint adjustments.
    const external = imported.map((r) => ({ ...r }));
    for (const f of flows.filter(
      (f) =>
        !fundingVerified &&
        !f.opening &&
        ['contribution', 'withdrawal', 'transfer'].includes(f.type) &&
        f.evidence?.dateUnknown !== true &&
        f.date <= today,
    )) {
      const amount = new Big(f.amount)
        .times(f.type === 'withdrawal' || (f.type === 'transfer' && f.accountId === account?.id) ? -1 : 1)
        .toString();
      const nativeCandidates = imported.map((r) => ({
        id: r.id,
        accountId: account!.id,
        date: r.date,
        amount: Math.abs(Number(r.amount)),
        type: new Big(r.amount).gte(0) ? ('contribution' as const) : ('withdrawal' as const),
        toAccountId: null,
        description: r.description,
        opening: false,
        createdAt: r.date,
        source: 'csv' as const,
        verified: true,
      }));
      const matched = matchPrincipalEvidence(
        {
          ...f,
          accountId: account!.id,
          source: f.source ?? 'manual',
          sourceId: f.sourceId ?? f.id,
          sourceKey: f.sourceKey ?? f.id,
          verified: true,
        },
        nativeCandidates,
      );
      if (matched.match) continue;
      // Ambiguous evidence is surfaced rather than silently counted twice.
      if (matched.ambiguous) {
        c.missing.push(`Cash-flow overlap needs review: ${f.date} ${f.amount}.`);
        continue;
      }
      external.push({
        id: f.id,
        date: f.date,
        amount,
        source: f.source ?? 'Principal ledger',
        description: f.description,
      });
    }
    c.fundingRecords = [...records, ...external.filter((r) => !records.some((s) => s.id === r.id))];
    const currentDate = latest?.date;
    const previousDate = currentDate ? previousUsEquitySession(currentDate) : undefined;
    const previous =
      latest && !cashOnly
        ? providerRows.filter((v) => v.accountId === latest.accountId && v.date === previousDate).at(-1)
        : undefined;
    if (latest && previous && !cashOnly) {
      const flowsInPeriod = external.filter((f) => f.date > previous.date && f.date <= latest.date);
      const deposits = total(flowsInPeriod.filter((f) => new Big(f.amount).gt(0)).map((f) => f.amount));
      const withdrawals = new Big(total(flowsInPeriod.filter((f) => new Big(f.amount).lt(0)).map((f) => f.amount)))
        .abs()
        .toString();
      const change = new Big(latest.value).minus(previous.value).minus(deposits).plus(withdrawals).toString();
      c.daily = {
        currentValue: latest.value,
        previousValue: previous.value,
        currentDate: latest.date,
        previousDate: previous.date,
        deposits,
        withdrawals,
        change,
        percent: percent(change, new Big(previous.value).plus(deposits).toString()),
        method: 'Latest consecutive reported account values − external net funding',
        estimated: false,
      };
      c.dailyChange = change;
    } else if (c.dailyChange != null) {
      c.daily = {
        currentValue: c.currentValue,
        previousValue: new Big(c.currentValue).minus(c.dailyChange).toString(),
        currentDate: valuationDate(holdingAsOf ?? c.valueAsOf),
        previousDate: previousUsEquitySession(valuationDate(holdingAsOf ?? c.valueAsOf)),
        deposits: '0',
        withdrawals: '0',
        change: c.dailyChange,
        percent: percent(c.dailyChange, new Big(c.currentValue).minus(c.dailyChange).toString()),
        method: 'Native holding daily attribution (account cash history unavailable)',
        estimated: true,
      };
    }
  }
  const adjustments: NonNullable<InvestmentAnalytics['accountValueAdjustments']> = [];
  const m1All = input.allPortfolioNames.filter((n) => /^m1\b/i.test(n));
  const m1 = portfolios.filter((p) => /^m1\b/i.test(p.name));
  const combined = sources.valuations.filter((v) => /^m1 total$/i.test(v.name)).at(-1);
  if (combined && m1All.length && m1.length === m1All.length && m1.every((p) => p.currencyCode === 'USD')) {
    const componentsValue = total(m1.map((p) => p.calculation!.currentValue));
    const adjustment: (typeof adjustments)[number] = {
      applied: m1.every((p) => combined.date >= valuationDate(p.calculation!.valueAsOf ?? today)),
      label: 'M1 combined account reconciliation',
      portfolioIds: m1.map((p) => p.id),
      value: combined.value,
      componentsValue,
      difference: new Big(combined.value).minus(componentsValue).toString(),
      source: combined.source,
      asOf: combined.date,
    };
    const previous = sources.valuations
      .filter((v) => v.accountId === combined.accountId && v.date === previousUsEquitySession(combined.date))
      .at(-1);
    if (previous && adjustment.applied) {
      const external = m1
        .flatMap((p) => p.calculation!.fundingRecords ?? [])
        .filter((r) => !r.excluded && r.date > previous.date && r.date <= combined.date);
      const groupChange = new Big(combined.value)
        .minus(previous.value)
        .minus(total(external.map((r) => r.amount)))
        .toString();
      adjustment.previousValue = previous.value;
      adjustment.dailyChange = groupChange;
      adjustment.dailyDifference = new Big(groupChange)
        .minus(total(m1.map((p) => p.calculation!.dailyChange)))
        .toString();
    }
    adjustments.push(adjustment);
  }
  const adjust = total(adjustments.filter((a) => a.applied).map((a) => a.difference));
  const gainRows = portfolios.map((p) => p.calculation!.accountGain);
  const estimated =
    portfolios.some((p) => p.calculation!.estimated || p.calculation!.accountGain == null) || adjustments.length > 0;
  metrics.accountGain = {
    value: gainRows.some((v) => v != null) ? new Big(total(gainRows)).plus(adjust).toString() : null,
    status: estimated ? 'partial' : 'verified',
    estimated,
    reason: estimated ? 'Includes supported estimates; click for account values, principal and sources.' : undefined,
  };
  metrics.marketValue = {
    value: portfolios.some((p) => p.marketValue != null)
      ? new Big(total(portfolios.map((p) => p.marketValue))).plus(adjust).toString()
      : null,
    status: estimated ? 'partial' : 'verified',
    estimated,
  };
  metrics.netInvested = {
    value: total(portfolios.map((p) => p.calculation!.principal)),
    status: portfolios.some((p) => p.calculation!.principal == null) ? 'partial' : 'verified',
    reason: 'Reconciled net principal; crypto trading costs are separate.',
  };
  const cashMissing = portfolios.some((p) => p.cash == null);
  const knownCash = total(portfolios.map((p) => p.cash));
  metrics.knownCash = { value: knownCash, status: cashMissing ? 'partial' : 'verified' };
  metrics.unknownCashCount = {
    value: String(portfolios.filter((p) => p.cash == null).length),
    status: cashMissing ? 'partial' : 'verified',
  };
  metrics.cash = {
    value: portfolios.some((p) => p.cash != null) ? knownCash : null,
    status: cashMissing ? 'partial' : 'verified',
    estimated: cashMissing,
    reason: cashMissing ? 'Known account cash; unrecorded balances are excluded.' : undefined,
  };
  metrics.contributions = {
    value: total(portfolios.map((p) => p.calculation!.importedDeposits)),
    status: 'partial',
    reason: 'Imported external cash deposits; reconciled opening principal is shown separately.',
  };
  metrics.withdrawals = {
    value: total(portfolios.map((p) => p.calculation!.importedWithdrawals)),
    status: 'partial',
    reason: 'Imported external withdrawals and returned deposits.',
  };
  const daily = portfolios.flatMap((p) => (p.calculation!.daily ? [p.calculation!.daily!] : []));
  const sameDailyDate = new Set(daily.map((d) => d.currentDate)).size <= 1;
  metrics.dailyChange = {
    value: daily.length
      ? new Big(total(daily.map((d) => d.change))).plus(total(adjustments.map((a) => a.dailyDifference))).toString()
      : null,
    status:
      sameDailyDate &&
      daily.length === portfolios.filter((p) => Number(p.marketValue) !== 0).length &&
      daily.every((d) => !d.estimated)
        ? 'verified'
        : 'partial',
    estimated: !sameDailyDate || daily.some((d) => d.estimated),
    reason: 'Reported account changes where consecutive valuations exist; holding attribution estimates otherwise.',
  };
  let dailyBase = new Big(total(daily.map((d) => new Big(d.previousValue).plus(d.deposits).toString())));
  for (const a of adjustments.filter((a) => a.previousValue != null))
    dailyBase = dailyBase
      .minus(
        total(portfolios.filter((p) => a.portfolioIds.includes(p.id)).map((p) => p.calculation!.daily?.previousValue)),
      )
      .plus(a.previousValue!);
  metrics.dailyChangePercent = {
    value: percent(metrics.dailyChange.value, dailyBase.toString()),
    status: metrics.dailyChange.status,
    estimated: metrics.dailyChange.estimated,
  };
  return adjustments;
}
