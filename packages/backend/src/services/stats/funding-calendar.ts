import { ACCOUNT_CATEGORIES as Category } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import { connection } from '@models/index';
import { findTransactions } from '@models/transactions-query';
import { hasSettledStatus } from '@services/bank-data-providers/enablebanking/utils/transaction-metadata';
import { listInvestmentGroupSources } from '@services/investments/groups';
import { getFinanceAccounts } from '@services/personal-finance';
import type { PrincipalTransferRule } from '@services/personal-finance/principal-types';
import { Op, QueryTypes } from 'sequelize';

import { deriveFundingCalendar, type FundingAccount } from './funding-calendar-model';

const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const roleFor = (category: string): FundingAccount['role'] =>
  ['investment', 'investments', 'retirement', 'crypto'].includes(category) ? 'Investments' :
  ['saving', 'savings'].includes(category) ? 'Savings' :
  ['general', 'current-account', 'cash', 'spendable'].includes(category) ? 'spendable' : 'other';

export async function getFundingCalendar({ userId, from, to }: { userId: number; from: string; to: string }) {
  // Read a small padded window for linked legs posted across the month boundary.
  // Dates on the response are always restricted to the selected month.
  const start = new Date(Date.parse(from) - 8 * 86400000);
  const end = new Date(Date.parse(to) + 9 * 86400000);
  const owner = userId === Number(process.env.FINANCE_OWNER_USER_ID || '1');
  const [native, reporting, rules, mappings, rows, groupSources] = await Promise.all([
    Accounts.findAll({ where: { userId }, attributes: ['id', 'name', 'accountCategory'] }),
    owner ? getFinanceAccounts(userId) : Promise.resolve([]),
    owner ? connection.sequelize.query<PrincipalTransferRule>(
      'SELECT * FROM "PersonalFinancePrincipalTransferRules" WHERE "userId"=:userId AND "isEnabled"',
      { replacements: { userId }, type: QueryTypes.SELECT, logging: false },
    ) : Promise.resolve([]),
    owner ? connection.sequelize.query<{ bankHistoryMappings: { sourceAccountIds: string[]; nativeAccountIds: string[] }[] }>(
      'SELECT "bankHistoryMappings" FROM "PersonalFinanceSettings" WHERE "userId"=:userId',
      { replacements: { userId }, type: QueryTypes.SELECT, logging: false },
    ) : Promise.resolve([]),
    findTransactions({
      access: { accountOwner: userId }, planned: 'exclude', balanceAdjustments: 'exclude', transfers: 'include', completeness: 'all',
      where: { time: { [Op.gte]: start, [Op.lt]: end } },
      attributes: ['id', 'accountId', 'time', 'amount', 'currencyCode', 'transactionType', 'transferNature', 'transferId', 'note', 'externalData', 'refundLinked', 'paymentParentId', 'excludeFromStats'],
    }),
    listInvestmentGroupSources(userId),
  ]);
  const groupByAccount = new Map(groupSources.map(a => [a.id,a.name]));
  const mapped = new Map<string, Set<FundingAccount['role']>>();
  const reportingById = new Map(reporting.map(a => [a.id, a]));
  const add = (id: string, category: string) => {
    const roles = mapped.get(id) ?? new Set<FundingAccount['role']>();
    roles.add(roleFor(category));
    mapped.set(id, roles);
  };
  for (const a of reporting) if (a.balanceKind === 'asset')
    for (const id of a.nativeAccountIds ?? []) add(id, a.categoryId);
  for (const mapping of mappings[0]?.bankHistoryMappings ?? [])
    for (const nativeId of mapping.nativeAccountIds)
      for (const reportingId of mapping.sourceAccountIds) {
        const a = reportingById.get(reportingId);
        if (a?.balanceKind === 'asset') add(nativeId, a.categoryId);
      }
  const accounts: FundingAccount[] = native.map(a => {
    const roles = mapped.get(a.id);
    const role = a.accountCategory === Category.creditCard ? 'other' :
      groupByAccount.has(a.id) ? 'Investments' :
      roles?.size === 1 ? [...roles][0]! : roles && roles.size > 1 ? 'other' : roleFor(a.accountCategory);
    return { id: a.id, name: groupByAccount.get(a.id) ?? a.name, role };
  });
  const entries = deriveFundingCalendar({
    accounts, rules, from, to,
    ruleDestinations: reporting.filter(a => a.balanceKind === 'asset').map(a => ({ id: a.id, name: a.name, role: roleFor(a.categoryId) })),
    transactions: rows.map(tx => ({
      id: tx.id, accountId: tx.accountId, date: localDate.format(new Date(tx.time)),
      amount: tx.amount.toNumber(), currency: tx.currencyCode, type: tx.transactionType,
      nature: tx.transferNature, transferId: tx.transferId || null, note: tx.note ?? '',
      eligible: !tx.excludeFromStats && !tx.refundLinked && !tx.paymentParentId && tx.externalData?.hold !== true && hasSettledStatus({ tx }),
    })),
  });
  return { entries };
}
