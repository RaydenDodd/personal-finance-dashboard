import { ACCOUNT_CATEGORIES, asCents, type NetWorthHistoryGranularity } from '@bt/shared/types';
import { connection } from '@models/index';
import type { NetWorthHistoryPointCents } from '@services/stats/get-net-worth-history/types';
import { generatePeriodBuckets } from '@services/stats/utils';
import { format } from 'date-fns';
import { QueryTypes } from 'sequelize';

import type { BankHistoryMapping } from './bank-history';
import { FINANCE_AUTOMATION_CUTOFF, cents } from './calculations';
import { getFinanceDashboard } from './index';
import type { FinanceAccount, FinanceSnapshot, HistoryPoint } from './types';

export interface NativeValuation {
  id: string;
  nativeAccountId: string;
  date: string;
  balanceCents: number;
  createdAt: string;
}
export interface NativeIdentity {
  id: string;
  name: string;
  accountCategory: string;
  currencyCode: string;
  excludeFromStats: boolean;
}
export type RecordedNetWorthPoint = NetWorthHistoryPointCents & {
  complete: boolean;
  liabilitiesAvailable: boolean;
  historySource: 'imported' | 'recorded';
  valuationDates: Record<string, string>;
};
export function assembleRecordedHistory({
  accounts,
  snapshots,
  history,
  mappings,
  nativeAccounts,
  nativeSnapshots,
}: {
  accounts: FinanceAccount[];
  snapshots: FinanceSnapshot[];
  history: HistoryPoint[];
  mappings: BankHistoryMapping[];
  nativeAccounts: NativeIdentity[];
  nativeSnapshots: NativeValuation[];
}): RecordedNetWorthPoint[] {
  const included = accounts.filter((a) => a.included),
    activeNative = nativeAccounts.filter((a) => !a.excludeFromStats && a.currencyCode === 'USD');
  const point = (date: string, source: 'imported' | 'recorded') =>
    ({
      date,
      assets: { cash: asCents(0), investments: asCents(0), vehicles: asCents(0), ventures: asCents(0) },
      assetsTotal: asCents(0),
      liabilities: {
        [ACCOUNT_CATEGORIES.creditCard]: asCents(0),
        [ACCOUNT_CATEGORIES.loan]: asCents(0),
        [ACCOUNT_CATEGORIES.overdraft]: asCents(0),
      },
      liabilitiesTotal: null,
      netWorth: null,
      complete: true,
      liabilitiesAvailable: false,
      historySource: source,
      valuationDates: {},
    }) as RecordedNetWorthPoint;
  const add = (p: RecordedNetWorthPoint, value: number, category: string, liabilityKind?: string) => {
    if (liabilityKind === ACCOUNT_CATEGORIES.loan) p.liabilities.loan = asCents(p.liabilities.loan + value);
    else if (value < 0) {
      const kind = liabilityKind === ACCOUNT_CATEGORIES.creditCard ? 'credit-card' : 'overdraft';
      p.liabilities[kind] = asCents(p.liabilities[kind] + value);
    } else {
      const kind = ['investments', 'retirement', 'investment'].includes(category) ? 'investments' : 'cash';
      p.assets[kind] = asCents(p.assets[kind] + value);
    }
  };
  const finish = (p: RecordedNetWorthPoint) => {
    p.assetsTotal = asCents(Object.values(p.assets).reduce((a, b) => a + b, 0));
    p.liabilitiesTotal = p.liabilitiesAvailable
      ? asCents(Object.values(p.liabilities).reduce((a, b) => a + b, 0))
      : null;
    p.netWorth = p.complete && p.liabilitiesTotal !== null ? asCents(p.assetsTotal + p.liabilitiesTotal) : null;
    return p;
  };
  const historical = history
    .filter((h) => h.date < FINANCE_AUTOMATION_CUTOFF)
    .map((h) => {
      const p = point(h.date, 'imported');
      p.complete = h.complete;
      for (const a of included) {
        const value = h.balances[a.id];
        if (typeof value !== 'number') continue;
        add(
          p,
          a.balanceKind === 'liability' ? -Math.abs(cents(value)) : cents(value),
          a.categoryId,
          a.balanceKind === 'liability' ? ACCOUNT_CATEGORIES.creditCard : undefined,
        );
        p.valuationDates[a.id] = h.valuationDates[a.id] ?? h.date;
      }
      // Assets-only source sheets contain no evidence of the debt level, even if it happened to be zero.
      p.liabilitiesAvailable = included.some(
        (a) => a.balanceKind === 'liability' && typeof h.balances[a.id] === 'number',
      );
      return finish(p);
    });
  const latestReporting = (id: string, date: string) =>
    snapshots.filter((s) => s.accountId === id && s.date <= date).at(-1);
  // On a post-cutoff observation, a stale provider component can be an as-of
  // fallback, retaining its earlier real date. It never enters pre-cutoff bars.
  const latestNative = (id: string, date: string) =>
    nativeSnapshots
      .filter((s) => s.nativeAccountId === id && s.date <= date)
      .sort(
        (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      )
      .at(-1);
  const dates = [
    ...new Set(
      [
        ...nativeSnapshots.filter((s) => activeNative.some((a) => a.id === s.nativeAccountId)).map((s) => s.date),
        ...snapshots.map((s) => s.date),
      ].filter((d) => d >= FINANCE_AUTOMATION_CUTOFF),
    ),
  ].sort();
  const live = dates.map((date) => {
    const p = point(date, 'recorded'),
      usedNative = new Set<string>(),
      usedReporting = new Set<string>();
    for (const m of mappings) {
      const members = included.filter((a) => m.sourceAccountIds.includes(a.id));
      if (!members.length) continue;
      members.forEach((a) => usedReporting.add(a.id));
      m.nativeAccountIds.forEach((id) => usedNative.add(id));
      const linked = m.nativeAccountIds.filter((id) => activeNative.some((a) => a.id === id));
      const native = linked.map((id) => latestNative(id, date));
      const manual = members.map((a) => latestReporting(a.id, date));
      const explicitCorrection = manual.some(
        (s) => s?.date === date && s.verified && (s.source === 'manual' || s.isManualCorrection),
      );
      if (
        linked.length === m.nativeAccountIds.length &&
        linked.length &&
        native.every(Boolean) &&
        !explicitCorrection
      ) {
        for (const s of native) {
          const a = activeNative.find((a) => a.id === s!.nativeAccountId)!;
          add(p, Number(s!.balanceCents), a.accountCategory, a.accountCategory);
          p.valuationDates[a.id] = s!.date;
        }
      } else {
        for (const [i, a] of members.entries()) {
          const s = manual[i];
          if (!s) {
            if (snapshots.some((v) => v.accountId === a.id && v.date <= date)) p.complete = false;
            continue;
          }
          add(
            p,
            a.balanceKind === 'liability' ? -Math.abs(cents(s.balance)) : cents(s.balance),
            a.categoryId,
            a.balanceKind === 'liability' ? ACCOUNT_CATEGORIES.creditCard : undefined,
          );
          p.valuationDates[a.id] = s.date;
        }
      }
    }
    for (const a of included.filter((a) => !usedReporting.has(a.id))) {
      const s = latestReporting(a.id, date);
      if (s) {
        add(
          p,
          a.balanceKind === 'liability' ? -Math.abs(cents(s.balance)) : cents(s.balance),
          a.categoryId,
          a.balanceKind === 'liability' ? ACCOUNT_CATEGORIES.creditCard : undefined,
        );
        p.valuationDates[a.id] = s.date;
      }
    }
    for (const a of activeNative.filter((a) => !usedNative.has(a.id))) {
      const s = latestNative(a.id, date);
      if (s) {
        add(p, Number(s.balanceCents), a.accountCategory, a.accountCategory);
        p.valuationDates[a.id] = s.date;
      } else p.complete = false;
    }
    p.liabilitiesAvailable = activeNative
      .filter((a) => ['credit-card', 'loan', 'overdraft'].includes(a.accountCategory))
      .every((a) => Boolean(latestNative(a.id, date)));
    return finish(p);
  });
  return [...historical, ...live].sort((a, b) => a.date.localeCompare(b.date));
}
export function selectRecordedPeriods<T extends { date: string }>(
  points: T[],
  from: string,
  to: string,
  granularity: NetWorthHistoryGranularity,
): T[] {
  return generatePeriodBuckets({ from, to, granularity }).flatMap((bucket) => {
    const start = format(bucket.periodStart, 'yyyy-MM-dd'),
      end = format(bucket.periodEnd, 'yyyy-MM-dd');
    // A bucket crossing the authority cutoff can contain one real point from each source.
    const actual = points.filter((p) => p.date >= start && p.date <= end);
    return [
      actual.filter((p) => p.date < FINANCE_AUTOMATION_CUTOFF).at(-1),
      actual.filter((p) => p.date >= FINANCE_AUTOMATION_CUTOFF).at(-1),
    ].filter((p): p is T => Boolean(p));
  });
}
export function recordedCombinedHistory(
  points: RecordedNetWorthPoint[],
  from: string,
  to: string,
  other: Array<{ date: string; portfoliosBalance: number; venturesBalance: number; vehiclesBalance: number }> = [],
) {
  return points
    .filter((p) => p.date >= from && p.date <= to)
    .map((p) => {
      const extra = p.historySource === 'recorded' ? other.find((row) => row.date === p.date) : undefined;
      const portfoliosBalance = extra?.portfoliosBalance ?? 0,
        venturesBalance = extra?.venturesBalance ?? 0,
        vehiclesBalance = extra?.vehiclesBalance ?? 0;
      const accountsBalance = p.assetsTotal + (p.liabilitiesTotal ?? 0);
      return {
        date: p.date,
        accountsBalance,
        portfoliosBalance,
        venturesBalance,
        vehiclesBalance,
        loansBalance: 0,
        totalBalance: accountsBalance + portfoliosBalance + venturesBalance + vehiclesBalance,
        historySource: p.historySource,
        complete: p.complete && p.liabilitiesAvailable,
        liabilitiesAvailable: p.liabilitiesAvailable,
        valuationDates: p.valuationDates,
      };
    });
}
export async function getRecordedNativeHistory(userId: number): Promise<RecordedNetWorthPoint[] | null> {
  const query = <T>(sql: string): Promise<T[]> =>
    connection.sequelize.query(sql, { replacements: { userId }, type: QueryTypes.SELECT, logging: false });
  const settings = await query<{ bankHistoryMappings: BankHistoryMapping[] }>(
    'SELECT "bankHistoryMappings" FROM "PersonalFinanceSettings" WHERE "userId"=:userId',
  );
  if (!settings[0]?.bankHistoryMappings?.length) return null;
  const [dashboard, nativeAccounts, nativeSnapshots] = await Promise.all([
    getFinanceDashboard(userId, { granularity: 'daily' }),
    query<NativeIdentity>(
      'SELECT id,name,"accountCategory","currencyCode","excludeFromStats" FROM "Accounts" WHERE "userId"=:userId',
    ),
    query<NativeValuation>(
      'SELECT id,"nativeAccountId",date::text,"balanceCents","createdAt"::text FROM "PersonalFinanceSnapshots" WHERE "userId"=:userId AND "nativeAccountId" IS NOT NULL ORDER BY date,"createdAt",id',
    ),
  ]);
  return assembleRecordedHistory({
    accounts: dashboard.accounts,
    snapshots: dashboard.snapshots,
    history: dashboard.history,
    mappings: settings[0].bankHistoryMappings,
    nativeAccounts,
    nativeSnapshots,
  });
}
