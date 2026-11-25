import { TRANSACTION_TRANSFER_NATURE as Nature, TRANSACTION_TYPES as Type } from '@bt/shared/types';
import { deriveFundingCalendar, type FundingTransaction, type FundingAccount } from './funding-calendar-model';

const accounts: FundingAccount[] = [
  { id: 'bank', name: 'Checking', role: 'spendable' },
  { id: 'broker', name: 'M1', role: 'Investments' },
  { id: 'saving', name: 'Savings', role: 'Savings' },
];
const tx = (id: string, patch: Partial<FundingTransaction> = {}): FundingTransaction => ({
  id, accountId: 'bank', date: '2026-11-21', amount: 200, currency: 'USD', type: Type.expense,
  nature: Nature.not_transfer, transferId: null, note: '', eligible: true, ...patch,
});
const run = (transactions: FundingTransaction[]) => deriveFundingCalendar({
  transactions, accounts, rules: [], ruleDestinations: [], from: '2026-11-01', to: '2026-11-30',
});
describe('transaction-based funding calendar', () => {
  it('counts an outgoing M1 payment even without a native portfolio transfer', () => {
    expect(run([tx('a', { note: 'M1' }), tx('b', { note: 'M1' })])).toMatchObject([
      { id: 'a', group: 'Investments', amount: 200 }, { id: 'b', group: 'Investments', amount: 200 },
    ]);
  });
  it('counts linked legs once on the outgoing date, even when the deposit posts next month', () => {
    expect(run([
      tx('a', { transferId: 'pair', nature: Nature.common_transfer, date: '2026-11-30', note: 'M1' }),
      tx('b', { accountId: 'broker', transferId: 'pair', nature: Nature.common_transfer, type: Type.income, date: '2026-12-02' }),
    ])).toMatchObject([{ id: 'a', group: 'Investments', date: '2026-11-30', amount: 200 }]);
  });
  it('uses actual bank income and savings transfers, not dividends or pending activity', () => {
    expect(run([
      tx('salary', { type: Type.income, amount: 2300 }),
      tx('div', { accountId: 'broker', type: Type.income, note: 'Dividend' }),
      tx('pending', { note: 'M1', eligible: false }),
      tx('save', { transferId: 's', nature: Nature.common_transfer }),
      tx('receive', { transferId: 's', nature: Nature.common_transfer, accountId: 'saving', type: Type.income }),
    ])).toMatchObject([{ id: 'salary', group: 'Income', amount: 2300 }, { id: 'save', group: 'Savings', amount: 200 }]);
  });
  it('uses confirmed destination rules without reading principal amounts', () => {
    const rows = deriveFundingCalendar({
      transactions: [tx('a', { note: 'ACH Savings', amount: 100 })], accounts,
      ruleDestinations: [{ id: 'target', name: 'Emergency Fund', role: 'Savings' }],
      rules: [{ id: 'rule', sourceNativeAccountId: 'bank', destinationAccountId: 'target', exactDescription: 'ACH Savings', effectiveFrom: '2026-01-01', isEnabled: true }],
      from: '2026-11-01', to: '2026-11-30',
    });
    expect(rows).toMatchObject([{ group: 'Savings', label: 'Emergency Fund', amount: 100 }]);
  });
});
