import type { Period } from '@/composable/use-period-navigation';
import { ROUTES_NAMES } from '@/routes/constants';
import { TRANSACTION_TYPES } from '@bt/shared/types';
import { format } from 'date-fns';
import type { RouteLocationRaw } from 'vue-router';

import type { MoneyFlow, MoneyFlowNode } from './build-money-flow';

export type FlowBranch = 'income' | 'expenses' | 'taxes' | 'savings';
export interface FlowDrillDown {
  categoryIds: string[];
  transactionType?: TRANSACTION_TYPES;
}

/** No destination is inferred from a synthetic balance or an investment/venture ID. */
export function moneyFlowDrillDown(flow: MoneyFlow, branch: FlowBranch, node?: MoneyFlowNode): FlowDrillDown | undefined {
  const nodes = node ? [node] : branch === 'income' ? flow.sources : branch === 'expenses' ? flow.expenseNodes :
    branch === 'taxes' ? flow.taxNodes : [];
  const categoryIds = [...new Set(nodes.flatMap((item) => item.transactionCategoryIds ?? []))];
  if (!categoryIds.length) return undefined;
  return {
    categoryIds,
    transactionType: branch === 'income' ? TRANSACTION_TYPES.income :
      branch === 'savings' ? undefined : TRANSACTION_TYPES.expense,
  };
}

export function moneyFlowTransactionsLocation(period: Period, target: FlowDrillDown): RouteLocationRaw {
  return {
    name: ROUTES_NAMES.transactions,
    query: {
      start: format(period.from, 'yyyy-MM-dd'),
      end: format(period.to, 'yyyy-MM-dd'),
      categoryIds: target.categoryIds,
      transactionType: target.transactionType,
    },
  };
}
