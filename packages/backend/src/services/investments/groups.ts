import { ValidationError } from '@js/errors';
import { connection } from '@models/index';
import { randomUUID } from 'node:crypto';
import { QueryTypes, Transaction } from 'sequelize';

interface Group {
  id: string;
  name: string;
  sourceAccountId: string | null;
  portfolioIds: string[];
}
interface GroupInput {
  name: string;
  sourceAccountId: string | null;
  portfolioIds: string[];
}
interface SourceAccount {
  id: string;
  name: string;
  currencyCode: string;
  providerName: string;
  isActive: boolean;
}
const read = <T extends object>(sql: string, replacements: Record<string, unknown>, transaction?: Transaction) =>
  connection.sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT, transaction });
const write = (sql: string, replacements: Record<string, unknown>, transaction: Transaction) =>
  connection.sequelize.query(sql, { replacements, transaction });
const fail = (message: string): never => { throw new ValidationError({ message }); };
const lock = <T>(userId: number, fn: (tx: Transaction) => Promise<T>) =>
  connection.sequelize.transaction(async tx => {
    await write('SELECT pg_advisory_xact_lock(71404,:userId)', { userId }, tx);
    return fn(tx);
  });

const sources = (userId: number, tx?: Transaction) => read<SourceAccount>(`
  SELECT a.id,a.name,a."currencyCode",c."providerName",c."isActive"
  FROM "Accounts" a JOIN "BankDataProviderConnections" c ON c.id=a."bankDataProviderConnectionId"
  WHERE a."userId"=:userId AND c."userId"=:userId AND LOWER(REPLACE(c."providerType",'-',''))='simplefin'
  AND a."accountCategory" NOT IN ('credit-card','loan','vehicle','overdraft')
  ORDER BY a.name,a.id`, { userId }, tx);

export async function listInvestmentGroups(userId: number) {
  const [groups, sourceAccounts, portfolios] = await Promise.all([
    read<Group>(`
      SELECT g.id,g.name,g."sourceAccountId",
        COALESCE(array_agg(p.id ORDER BY p.name,p.id) FILTER (WHERE p.id IS NOT NULL), ARRAY[]::uuid[]) AS "portfolioIds"
      FROM "InvestmentAccountGroups" g
      LEFT JOIN "InvestmentAccountGroupMembers" m ON m."groupId"=g.id
      LEFT JOIN "Portfolios" p ON p.id=m."portfolioId" AND p."userId"=g."userId" AND p."deletedAt" IS NULL
      WHERE g."userId"=:userId GROUP BY g.id ORDER BY g.name,g.id
    `, { userId }),
    sources(userId),
    read<{id: string; name: string; isEnabled: boolean}>(
      'SELECT id,name,"isEnabled" FROM "Portfolios" WHERE "userId"=:userId AND "deletedAt" IS NULL ORDER BY name,id', { userId }),
  ]);
  return { groups, sourceAccounts, portfolios };
}

export async function listInvestmentGroupSources(userId: number) {
  return read<{id:string;name:string}>(`
    SELECT a.id,g.name FROM "InvestmentAccountGroups" g
    JOIN "Accounts" a ON a.id=g."sourceAccountId" AND a."userId"=g."userId"
    JOIN "BankDataProviderConnections" c ON c.id=a."bankDataProviderConnectionId" AND c."userId"=g."userId"
    WHERE g."userId"=:userId AND LOWER(REPLACE(c."providerType",'-',''))='simplefin'
    AND EXISTS (SELECT 1 FROM "InvestmentAccountGroupMembers" m JOIN "Portfolios" p ON p.id=m."portfolioId"
      WHERE m."groupId"=g.id AND p."userId"=g."userId" AND p."deletedAt" IS NULL)
  `,{userId});
}

export async function saveInvestmentGroup(userId: number, input: GroupInput, groupId?: string) {
  return lock(userId, async tx => {
    const id = groupId ?? randomUUID();
    if (groupId && !(await read<{id:string}>('SELECT id FROM "InvestmentAccountGroups" WHERE id=:id AND "userId"=:userId FOR UPDATE', {id,userId}, tx)).length)
      fail('Investment group not found');
    const portfolioIds = [...new Set(input.portfolioIds)];
    if (!portfolioIds.length || portfolioIds.length !== input.portfolioIds.length) fail('Select distinct portfolios');
    const owned = await read<{id:string}>('SELECT id FROM "Portfolios" WHERE "userId"=:userId AND "deletedAt" IS NULL AND id IN (:portfolioIds) FOR UPDATE', {userId,portfolioIds},tx);
    if (owned.length !== portfolioIds.length) fail('One or more portfolios are unavailable');
    const occupied = await read<{id:string}>(`
      SELECT m."portfolioId" AS id FROM "InvestmentAccountGroupMembers" m
      WHERE m."portfolioId" IN (:portfolioIds) AND m."groupId"<>:id`, {portfolioIds,id},tx);
    if (occupied.length) fail('Remove the portfolio from its existing group first');
    if (input.sourceAccountId) {
      if (!(await sources(userId,tx)).some(a => a.id === input.sourceAccountId)) fail('Select an owned SimpleFIN account');
      const used = await read<{id:string}>('SELECT id FROM "InvestmentAccountGroups" WHERE "sourceAccountId"=:sourceAccountId AND id<>:id AND "userId"=:userId', {userId,id,sourceAccountId:input.sourceAccountId},tx);
      if (used.length) fail('This SimpleFIN account is already mapped to a group');
    }
    const name = input.name.trim();
    if (!name || name.length > 100) fail('Enter a group name');
    if ((await read<{id:string}>('SELECT id FROM "InvestmentAccountGroups" WHERE "userId"=:userId AND LOWER(name)=LOWER(:name) AND id<>:id', {userId,id,name},tx)).length)
      fail('An investment group with this name already exists');
    const values = {id,userId,name,sourceAccountId:input.sourceAccountId};
    if (groupId) await write('UPDATE "InvestmentAccountGroups" SET name=:name,"sourceAccountId"=:sourceAccountId,"updatedAt"=NOW() WHERE id=:id AND "userId"=:userId', values,tx);
    else await write('INSERT INTO "InvestmentAccountGroups" (id,"userId",name,"sourceAccountId") VALUES (:id,:userId,:name,:sourceAccountId)',values,tx);
    // Preserve membership of soft-deleted portfolios for a later restore.
    await write('DELETE FROM "InvestmentAccountGroupMembers" m USING "Portfolios" p WHERE m."groupId"=:id AND p.id=m."portfolioId" AND p."deletedAt" IS NULL', {id},tx);
    for (const portfolioId of portfolioIds) await write('INSERT INTO "InvestmentAccountGroupMembers" ("groupId","portfolioId") VALUES (:id,:portfolioId)',{id,portfolioId},tx);
    return {id,name,sourceAccountId:input.sourceAccountId,portfolioIds};
  });
}

export async function deleteInvestmentGroup(userId: number, id: string) {
  return lock(userId, async tx => {
    if (!(await read<{id:string}>('SELECT id FROM "InvestmentAccountGroups" WHERE id=:id AND "userId"=:userId FOR UPDATE', {id,userId},tx)).length)
      fail('Investment group not found');
    await write('DELETE FROM "InvestmentAccountGroups" WHERE id=:id AND "userId"=:userId', {id,userId},tx);
    return {deleted: true};
  });
}
