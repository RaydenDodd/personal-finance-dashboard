import { ValidationError } from '@js/errors';
import { connection } from '@models/index';
import { getBaseCurrency } from '@models/users-currencies.model';
import { QueryTypes } from 'sequelize';

import { cents } from './calculations';
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
  const [dashboard, nativeStart] = await Promise.all([
    getFinanceDashboard(userId, { granularity: 'daily', mode: 'personal' }),
    read<{ liveFrom: string | null }>(
      `SELECT MIN(("createdAt" AT TIME ZONE 'America/New_York')::date)::text AS "liveFrom" FROM "Accounts" WHERE "userId"=:userId AND "bankDataProviderConnectionId" IS NOT NULL`,
      { userId },
    ),
  ]);
  return {
    mappings,
    liveFrom: nativeStart[0]?.liveFrom ?? '9999-12-31',
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
  return [...imported, ...native.filter((p) => p.date >= context.liveFrom)].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

export async function getBankAccountHistory(userId: number, nativeAccountId: string) {
  const context = await getBankHistoryContext(userId);
  if (!context) return null;
  const mapping = context.mappings.find((m) => m.nativeAccountIds.includes(nativeAccountId));
  if (!mapping) return null;
  const dashboard = await getFinanceDashboard(userId, { granularity: 'daily', mode: 'personal' });
  const source = new Set(mapping.sourceAccountIds);
  const points = dashboard.history
    .filter((p) => p.date < context.liveFrom)
    .flatMap((p) => {
      const recorded = Object.entries(p.balances).filter(([id, value]) => source.has(id) && value !== null);
      if (!recorded.length) return [];
      return [
        {
          date: p.date,
          balance: recorded.reduce((sum, [, value]) => sum + cents(value!), 0) / 100,
          source: 'imported' as const,
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
  return {
    label: mapping.label,
    grouped: mapping.nativeAccountIds.length > 1,
    nativeAccountIds: mapping.nativeAccountIds,
    sourceAccountIds: mapping.sourceAccountIds,
    liveFrom: context.liveFrom,
    points: [...points, ...live].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
