import * as statsController from '@controllers/stats.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { Router } from 'express';
import { createController } from '@controllers/helpers/controller-factory';
import { getPivotTableReport } from '@services/stats/reports/pivot.report';
import { getInvestmentContributionsReport } from '@services/stats/reports/investment-contributions.report';
import { getBaseCurrency } from '@models/users-currencies.model';
import { getCashFlows, getFinanceAccounts } from '@services/personal-finance';
import { z } from 'zod';

const router = Router({});

router.use(authenticateSession);

router.get('/balance-history', statsController.getBalanceHistory);
router.get('/total-balance', statsController.getTotalBalance);
router.get('/expenses-amount-for-period', statsController.getExpensesAmountForPeriod);
router.get('/spendings-by-categories', statsController.getSpendingsByCategories);
router.get('/spendings-by-categories/monthly', statsController.getMonthlySpendingsByCategories);
router.get('/combined-balance-history', statsController.getCombinedBalanceHistory);
router.get('/cash-flow', statsController.getCashFlow);
router.get('/net-worth-drivers', statsController.getNetWorthDrivers);
router.get('/net-worth-history', statsController.getNetWorthHistory);
router.get('/investment-contributions', statsController.getInvestmentContributions);
router.get('/venture-contributions', statsController.getVentureContributions);
router.get('/pivot', statsController.getPivotReport);
router.get('/cumulative', statsController.getCumulativeData);
router.get('/earliest-transaction-date', statsController.getEarliestTransactionDate);

// Calendar requests are intentionally bounded to a single month-sized window.
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((date) =>
  Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date,
);
const calendarQuery = z.object({
  query: z.object({ from: calendarDate, to: calendarDate }).refine(
    ({ from, to }) => from <= to && Date.parse(to) - Date.parse(from) <= 30 * 86400000,
    'Select at most 31 calendar days',
  ),
});

router.get('/calendar/spending', createController(calendarQuery, async ({ user, query }) => ({
  data: await getPivotTableReport({
    userId: user.id, ...query, granularity: 'daily', rowDimension: 'category', measure: 'expense',
  }),
})));

router.get('/calendar/funding', createController(calendarQuery, async ({ user, query }) => {
  const owner = user.id === Number(process.env.FINANCE_OWNER_USER_ID || '1');
  const [investments, currency, accounts, flows] = await Promise.all([
    getInvestmentContributionsReport({ userId: user.id, ...query, granularity: 'daily' }),
    getBaseCurrency({ userId: user.id }),
    owner ? getFinanceAccounts(user.id) : Promise.resolve([]),
    owner ? getCashFlows(user.id, undefined, query) : Promise.resolve([]),
  ]);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const savings = flows.flatMap((flow) => {
    if (flow.opening || flow.amount <= 0 || !['contribution', 'transfer'].includes(flow.type)) return [];
    const destination = byId.get(flow.type === 'transfer' ? flow.toAccountId ?? '' : flow.accountId);
    const origin = byId.get(flow.accountId);
    if (!destination?.included || destination.categoryId !== 'savings' || destination.balanceKind !== 'asset') return [];
    if (flow.type === 'transfer' && origin?.categoryId === 'savings') return [];
    return [{
      id: flow.id, date: flow.date, label: destination.name, amount: flow.amount,
      currency: destination.currencyCode, note: flow.description || 'Recorded savings deposit',
    }];
  });
  return { data: { investments, currencyCode: currency?.currencyCode ?? '', savings, savingsAvailable: owner } };
}));

export default router;
