import { calculateIncomePlan, type IncomePlanInput } from '@bt/shared/finance-income';
import type {
  BankIncomeRow,
  IncomeDashboard,
  IncomeDocument,
  IncomePaycheck,
} from '@bt/shared/types/income-management';
import { ValidationError } from '@js/errors';
import { connection } from '@models/index';
import { DEFAULT_CATEGORIES } from '@services/personal-finance/types';
import { randomUUID } from 'node:crypto';
import { QueryTypes, type Transaction } from 'sequelize';

import { emptyIncomeDocument, reconcileIncome, validatePaycheckLinks, partitionIncomeImport } from './ledger';

const query = async <T>(
  sql: string,
  replacements: Record<string, unknown> = {},
  transaction?: Transaction,
): Promise<T[]> =>
  connection.sequelize.query(sql, { type: QueryTypes.SELECT, replacements, transaction, logging: false });
const execute = (sql: string, replacements: Record<string, unknown>, transaction?: Transaction) =>
  connection.sequelize.query(sql, { replacements, transaction, logging: false });
const fail = (message: string): never => {
  throw new ValidationError({ message });
};
export async function getIncomeDocument(userId: number, transaction?: Transaction): Promise<IncomeDocument> {
  const rows = await query<{ income: IncomeDocument }>(
    'SELECT income FROM "PersonalFinanceSettings" WHERE "userId"=:userId',
    { userId },
    transaction,
  );
  return rows[0]?.income ?? emptyIncomeDocument();
}
export async function getBankIncome(userId: number, transaction?: Transaction): Promise<BankIncomeRow[]> {
  const rows = await query<{ id: string; date: string; amount: string; accountId: string; description: string }>(
    `
    SELECT t.id, to_char(t.time AT TIME ZONE 'America/New_York','YYYY-MM-DD') AS date,
      CASE WHEN t."refCurrencyCode"='USD' THEN t."refAmount" ELSE t.amount END AS amount,
      t."accountId", t.note AS description
    FROM "Transactions" t JOIN "Accounts" a ON a.id=t."accountId"
    WHERE t."userId"=:userId AND a."userId"=:userId AND t."deletedAt" IS NULL
      AND t."transactionType"='income' AND t."transferNature"='not_transfer'
      AND COALESCE(t."isPlanned",false)=false AND t."paymentParentId" IS NULL
      AND COALESCE(t."refundLinked",false)=false
      AND COALESCE(a."excludeFromStats",false)=false
      AND COALESCE(t."externalData"->>'balanceAdjustment','false') <> 'true'
      AND COALESCE(t."externalData"->>'pending','false') <> 'true'
      AND (t."refCurrencyCode"='USD' OR t."currencyCode"='USD') ORDER BY t.time, t.id`,
    { userId },
    transaction,
  );
  return rows.map((row) => ({ ...row, amount: Number(row.amount) / 100 }));
}
export async function getIncomeDashboard(
  userId: number,
  from: string,
  through: string,
  granularity: 'biweekly' | 'monthly' | 'yearly' = 'monthly',
): Promise<IncomeDashboard> {
  const [document, bankIncome] = await Promise.all([getIncomeDocument(userId), getBankIncome(userId)]);
  return {
    document,
    bankIncome,
    ...reconcileIncome(document, bankIncome, from, through, granularity),
    calculations: document.plans.map((plan) => ({ plan, result: calculateIncomePlan(plan.input) })),
  };
}
export async function saveIncomeDocument(userId: number, incoming: IncomeDocument): Promise<IncomeDocument> {
  return connection.sequelize.transaction(async (transaction: Transaction) => {
    await execute('SELECT pg_advisory_xact_lock(71415,:userId)', { userId }, transaction);
    const before = await getIncomeDocument(userId, transaction);
    if (incoming.revision !== before.revision) fail('Income data changed in another window. Reload before saving.');
    for (const list of [incoming.employers, incoming.paychecks, incoming.plans]) {
      if (new Set(list.map((item) => item.id)).size !== list.length) fail('Income record IDs must be unique');
    }
    const employers = new Set(incoming.employers.map((e) => e.id));
    if (
      incoming.paychecks.some((p) => !employers.has(p.employerId)) ||
      incoming.plans.some((p) => p.employerId && !employers.has(p.employerId))
    )
      fail('Every paycheck and linked plan must reference an existing employer');
    if (incoming.plans.some((p) => p.effectiveFrom && p.effectiveTo && p.effectiveFrom > p.effectiveTo))
      fail('Plan effective dates are reversed');
    if (incoming.employers.some((e) => e.startDate && e.endDate && e.startDate > e.endDate))
      fail('Employer dates are reversed');
    const error = validatePaycheckLinks(incoming.paychecks, await getBankIncome(userId, transaction));
    if (error) fail(error);
    const result = { ...incoming, revision: before.revision + 1 };
    await execute(
      `INSERT INTO "PersonalFinanceSettings" ("userId",categories,income) VALUES (:userId,CAST(:categories AS jsonb),CAST(:income AS jsonb))
      ON CONFLICT ("userId") DO UPDATE SET income=EXCLUDED.income,"updatedAt"=NOW()`,
      { userId, categories: JSON.stringify(DEFAULT_CATEGORIES), income: JSON.stringify(result) },
      transaction,
    );
    await execute(
      'INSERT INTO "PersonalFinanceAudit" (id,"userId",action,"entityId",details) VALUES (:id,:userId,:action,:entityId,CAST(:details AS jsonb))',
      {
        id: randomUUID(),
        userId,
        action: 'income.updated',
        entityId: String(userId),
        details: JSON.stringify({ before, after: result }),
      },
      transaction,
    );
    return result;
  });
}
export async function importPaychecks(
  userId: number,
  records: IncomePaycheck[],
  revision: number,
  previewOnly: boolean,
) {
  const document = await getIncomeDocument(userId);
  if (document.revision !== revision) fail('Income data changed. Preview the import again.');
  const partition = partitionIncomeImport(document.paychecks, records);
  const accepted = partition.accepted.map((record) => ({ ...record, id: randomUUID() }));
  const response = {
    inserted: accepted.length,
    duplicates: partition.duplicates,
    conflicts: partition.conflicts,
    previewOnly,
    records: accepted,
  };
  if (previewOnly) return response;
  await saveIncomeDocument(userId, { ...document, paychecks: [...document.paychecks, ...accepted] });
  return response;
}
export function calculatePlan(input: IncomePlanInput) {
  return calculateIncomePlan(input);
}
