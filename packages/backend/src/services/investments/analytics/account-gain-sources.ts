import { connection } from '@models/index';
import { getCashFlows, getFinanceAccounts } from '@services/personal-finance';
import { QueryTypes } from 'sequelize';

export interface AccountValuation {
  cash?: string;
  portfolioId?: string;
  accountId: string;
  name: string;
  date: string;
  value: string;
  source: string;
}

/** Owner-scoped, dated provider account totals. No provider requests or history replay. */
export async function getAccountGainSources(userId: number) {
  const [accounts, flows, valuations] = await Promise.all([
    getFinanceAccounts(userId),
    getCashFlows(userId),
    connection.sequelize.query(
      `SELECT "accountId",name,date,value,source FROM (
        SELECT observations.*,row_number() OVER (PARTITION BY "accountId" ORDER BY date DESC) AS rank FROM (
        SELECT DISTINCT ON (s."nativeAccountId",s.date) s."nativeAccountId" AS "accountId",a.name,s.date::text AS date,
          (s."balanceCents"::numeric/100)::text AS value,s."sourceLabel" AS source
        FROM "PersonalFinanceSnapshots" s JOIN "Accounts" a ON a.id=s."nativeAccountId"
        WHERE s."userId"=:userId AND a."userId"=:userId AND s.verified
          AND s."currencyCode"='USD' AND s.date<=CURRENT_DATE
        ORDER BY s."nativeAccountId",s.date,s."createdAt" DESC,s.id DESC
        ) observations
      ) observations WHERE rank<=30 ORDER BY date`,
      { replacements: { userId }, type: QueryTypes.SELECT, logging: false },
    ) as Promise<AccountValuation[]>,
  ]);
  return { accounts, flows, valuations };
}
