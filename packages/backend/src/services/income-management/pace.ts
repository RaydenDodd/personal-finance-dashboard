import Accounts from '@models/accounts.model';
import { findTransactions } from '@models/transactions-query';
import { hasSettledStatus } from '@services/bank-data-providers/enablebanking/utils/transaction-metadata';
import { getFinanceAccounts } from '@services/personal-finance';
import { Op } from 'sequelize';

import { getIncomeDocument, getBankIncome } from './index';
import { buildFundingEvents, buildPlanPace } from './pace-derivations';
import { getPayrollDocument } from './payroll';
import { reconcileIncomeWithPayroll } from './payroll-income';

export async function getPlanPace(userId: number, from: string, through: string) {
  const now = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const [document, bankIncome, accounts, reporting, txs, payroll] = await Promise.all([
    getIncomeDocument(userId),
    getBankIncome(userId),
    Accounts.findAll({ where: { userId }, attributes: ['id', 'name', 'accountCategory', 'excludeFromStats'] }),
    getFinanceAccounts(userId),
    findTransactions({
      access: { accountOwner: userId },
      planned: 'exclude',
      balanceAdjustments: 'exclude',
      transfers: 'include',
      completeness: 'all',
      where: {
        time: {
          [Op.gte]: new Date(Date.parse(from) - 7 * 86400000),
          [Op.lt]: new Date(Date.parse(through) + 8 * 86400000),
        },
      },
      order: [['time', 'ASC']],
    }),
    getPayrollDocument(userId),
  ]);
  const posted = txs.filter(
    (t) =>
      hasSettledStatus({ tx: t }) &&
      t.externalData?.hold !== true &&
      !t.paymentParentId &&
      !t.refundLinked &&
      t.externalData?.pending !== true,
  );
  const funding = buildFundingEvents(
    accounts.map((a) => ({ id: a.id, name: a.name, category: a.accountCategory, excluded: a.excludeFromStats })),
    reporting,
    posted
      .filter((t) => t.currencyCode === 'USD' || t.refCurrencyCode === 'USD')
      .map((t) => ({
        id: t.id,
        accountId: t.accountId,
        date: new Date(t.time).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
        amount: Math.abs((t.refCurrencyCode === 'USD' ? t.refAmount : t.amount).toNumber()),
        type: t.transactionType,
        note: t.note ?? '',
        transferId: t.transferId,
        nature: t.transferNature,
      })),
  );
  const daily = reconcileIncomeWithPayroll(document, bankIncome, payroll, from, through, 'daily').periods;
  const coverage =
    [
      ...posted.map((t) => new Date(t.time).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })),
      ...document.paychecks.filter((p) => p.evidence === 'actual').map((p) => p.date),
      ...payroll.statements.map((p) => p.payDate),
    ].sort()[0] ?? null;
  return buildPlanPace(
    document,
    daily.map((p) => ({ date: p.date, amount: p.actualNet })),
    funding,
    from,
    through,
    now,
    coverage,
  );
}
