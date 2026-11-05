import {
  sumTransactionTotals,
  TRANSACTION_TRANSFER_NATURE as Nature,
  TRANSACTION_TYPES as Type,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

describe('spending totals', () => {
  it('counts purchases and earnings while keeping every transfer kind separate', () => {
    const rows = [
      { transferNature: Nature.not_transfer, transactionType: Type.expense, refAmount: 25 },
      { transferNature: Nature.not_transfer, transactionType: Type.income, refAmount: 100 },
      ...Object.values(Nature)
        .filter((nature) => nature !== Nature.not_transfer)
        .flatMap((transferNature) => [
          { transferNature, transactionType: Type.expense, refAmount: 500 },
          { transferNature, transactionType: Type.income, refAmount: 500 },
        ]),
    ];
    expect(sumTransactionTotals(rows)).toEqual({ income: 100, expense: 25, net: 75, transfers: 5000 });
  });
});
