import { ValidationError } from '@js/errors';
import { connection } from '@models/index';
import { getBaseCurrency } from '@models/users-currencies.model';
import { QueryTypes } from 'sequelize';

import { FINANCE_AUTOMATION_CUTOFF, cents } from './calculations';
import { getFinanceAccounts, getFinanceCategories, getFinanceDashboard } from './index';

export interface BankHistoryMapping {
  id: string;
  label: string;
  sourceAccountIds: string[];
  nativeAccountIds: string[];
}
export interface ImportedBankPoint {
  date: string;
  balance: number;
  complete: boolean;
}
export interface BankHistoryContext {
  mappings: BankHistoryMapping[];
  points: ImportedBankPoint[];
  liveFrom: string;
  manualAdjustments?: Record<string, number>;
}
const read = <T>(sql: string, replacements: Record<string, unknown>): Promise<T[]> =>
  connection.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, logging: false });

export async function configureBankHistory(userId: number, mappings: BankHistoryMapping[]) {
  const [sources, native, categories] = await Promise.all([
    getFinanceAccounts(userId),
    read<{ id: string; currencyCode: string }>('SELECT id,"currencyCode" FROM "Accounts" WHERE "userId"=:userId', {
      userId,
    }),
    getFinanceCategories(userId),
  ]);
  const sourceIds = mappings.flatMap((m) => m.sourceAccountIds);
  const nativeIds = mappings.flatMap((m) => m.nativeAccountIds);
  if (
    new Set(sourceIds).size !== sourceIds.length ||
    new Set(nativeIds).size !== nativeIds.length ||
    sourceIds.some((id) => !sources.some((a) => a.id === id && a.currencyCode === 'USD')) ||
    nativeIds.some((id) => !native.some((a) => a.id === id && a.currencyCode === 'USD'))
  )
    throw new ValidationError({ message: 'Historical groups must use unique, owned USD accounts.' });
  await connection.sequelize.query(
    `INSERT INTO "PersonalFinanceSettings" ("userId",categories,"bankHistoryMappings") VALUES (:userId,CAST(:categories AS jsonb),CAST(:mappings AS jsonb))
    ON CONFLICT ("userId") DO UPDATE SET "bankHistoryMappings"=EXCLUDED."bankHistoryMappings","updatedAt"=NOW()`,
    {
      replacements: { userId, categories: JSON.stringify(categories), mappings: JSON.stringify(mappings) },
      logging: false,
    },
  );
  return { groups: mappings.length, sourceAccounts: sourceIds.length, linkedAccounts: nativeIds.length };
}

export async function getBankHistoryContext(userId: number): Promise<BankHistoryContext | null> {
  const settings = await read<{ bankHistoryMappings: BankHistoryMapping[] }>(
    'SELECT "bankHistoryMappings" FROM "PersonalFinanceSettings" WHERE "userId"=:userId',
    { userId },
  );
  const mappings = settings[0]?.bankHistoryMappings;
  if (!mappings?.length) return null;
  const base = await getBaseCurrency({ userId });
  if (base?.currencyCode !== 'USD') return null;
  const dashboard = await getFinanceDashboard(userId, { granularity: 'daily', mode: 'personal' });
  const manualAdjustments: Record<string, number> = {};
  const manualDates = [
    ...new Set(
      dashboard.snapshots
        .filter(
          (s) => s.date >= FINANCE_AUTOMATION_CUTOFF && s.verified && (s.source === 'manual' || s.isManualCorrection),
        )
        .map((s) => s.date),
    ),
  ];
  for (const date of manualDates)
    for (const mapping of mappings.filter((m) => m.nativeAccountIds.length)) {
      const values = mapping.sourceAccountIds.map((id) =>
        dashboard.snapshots.find((s) => s.accountId === id && s.date === date),
      );
      if (
        values.some((value) => !value) ||
        !values.some((value) => value!.verified && (value!.source === 'manual' || value!.isManualCorrection))
      )
        continue;
      const balances = await read<{ accountId: string; amount: string }>(
        `SELECT DISTINCT ON (b."accountId") b."accountId",b.amount FROM "Balances" b JOIN "Accounts" a ON a.id=b."accountId" WHERE a."userId"=:userId AND a.id IN (:ids) AND b.date<=:date ORDER BY b."accountId",b.date DESC`,
        { userId, ids: mapping.nativeAccountIds, date },
      );
      if (balances.length !== mapping.nativeAccountIds.length) continue;
      const delta =
        values.reduce((sum, value) => sum + cents(value!.balance), 0) -
        balances.reduce((sum, value) => sum + Number(value.amount), 0);
      manualAdjustments[date] = (manualAdjustments[date] ?? 0) + delta;
    }
  return {
    mappings,
    liveFrom: FINANCE_AUTOMATION_CUTOFF,
    manualAdjustments,
    points: dashboard.history.map((p) => ({ date: p.date, balance: p.knownTotal, complete: p.complete })),
  };
}

/** Imported monthly observations replace fabricated pre-connection daily balances.
 * Dates without an observation stay absent; current bank balances keep priority. */
export function mergeImportedBankHistory<
  T extends {
    date: string;
    accountsBalance: number;
    portfoliosBalance: number;
    venturesBalance: number;
    vehiclesBalance: number;
    loansBalance: number;
    totalBalance: number;
  },
>(native: T[], context: BankHistoryContext, from: string, to: string) {
  const imported = context.points
    .filter((p) => p.date >= from && p.date <= to && p.date < context.liveFrom)
    .map((p) => ({
      date: p.date,
      accountsBalance: cents(p.balance),
      portfoliosBalance: 0,
      venturesBalance: 0,
      vehiclesBalance: 0,
      loansBalance: 0,
      totalBalance: cents(p.balance),
      historySource: 'imported' as const,
      complete: p.complete,
    }));
  return [
    ...imported,
    ...native
      .filter((p) => p.date >= context.liveFrom)
      .map((p) => {
        const delta = context.manualAdjustments?.[p.date] ?? 0;
        return delta
          ? {
              ...p,
              accountsBalance: p.accountsBalance + delta,
              totalBalance: p.totalBalance + delta,
              historySource: 'manual' as const,
            }
          : p;
      }),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export async function getBankAccountHistory(userId: number, nativeAccountId: string) {
  const context = await getBankHistoryContext(userId);
  if (!context) return null;
  const mapping = context.mappings.find((m) => m.nativeAccountIds.includes(nativeAccountId));
  if (!mapping) return null;
  const dashboard = await getFinanceDashboard(userId, { granularity: 'daily' });
  const source = new Set(mapping.sourceAccountIds);
  const points = dashboard.history.flatMap((p) => {
    const recorded = Object.entries(p.balances).filter(([id, value]) => source.has(id) && value !== null);
    const active = mapping.sourceAccountIds.filter((id) => !p.inactiveAccountIds?.includes(id));
    if (!recorded.length || recorded.length !== active.length) return [];
    const sources = mapping.sourceAccountIds
      .map((id) => dashboard.snapshots.find((s) => s.accountId === id && s.date === p.date))
      .filter(Boolean);
    const correction = sources.some((s) => s!.verified && (s!.source === 'manual' || s!.isManualCorrection));
    const pointSource =
      p.date < context.liveFrom
        ? 'imported'
        : correction
          ? (sources.find((s) => s!.source === 'manual' || s!.isManualCorrection)?.source ?? 'manual')
          : 'google-sheets';
    if (p.date >= context.liveFrom && !correction && sources.some((s) => ['simplefin', 'plaid'].includes(s!.source)))
      return [];
    return [
      {
        date: p.date,
        balance: recorded.reduce((sum, [, value]) => sum + cents(value!), 0) / 100,
        source: pointSource,
        override:
          correction ||
          mapping.sourceAccountIds.every(
            (id) => dashboard.accounts.find((a) => a.id === id)?.preferredSource === 'manual',
          ),
      },
    ];
  });
  const bankRows = await read<{ date: string; amount: number; accountId: string }>(
    `SELECT b.date::text,b.amount,b."accountId" FROM "Balances" b JOIN "Accounts" a ON a.id=b."accountId" WHERE a."userId"=:userId AND a.id IN (:ids) AND b.date>=:liveFrom ORDER BY b.date`,
    { userId, ids: mapping.nativeAccountIds, liveFrom: context.liveFrom },
  );
  const dates = [...new Set(bankRows.map((b) => b.date))];
  const live = dates.flatMap((date) => {
    const rows = bankRows.filter((b) => b.date === date);
    if (new Set(rows.map((b) => b.accountId)).size !== mapping.nativeAccountIds.length) return [];
    return [{ date, balance: rows.reduce((sum, b) => sum + Number(b.amount), 0) / 100, source: 'bank' as const }];
  });
  const effective = new Map<string, { date: string; balance: number; source: string }>(
    live.map((point) => [point.date, point]),
  );
  for (const point of points)
    if (point.date < context.liveFrom || point.override || !effective.has(point.date))
      effective.set(point.date, { date: point.date, balance: point.balance, source: point.source });
  return {
    label: mapping.label,
    grouped: mapping.nativeAccountIds.length > 1,
    nativeAccountIds: mapping.nativeAccountIds,
    sourceAccountIds: mapping.sourceAccountIds,
    liveFrom: context.liveFrom,
    points: [...effective.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
