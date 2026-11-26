import { TRANSACTION_TRANSFER_NATURE as Nature, TRANSACTION_TYPES as Type } from '@bt/shared/types';
import { isReturnOrAwardDescription, selectPrincipalTransferRule } from '@services/personal-finance/principal-matching';
import type { PrincipalTransferRule } from '@services/personal-finance/principal-types';

type Role = 'Income' | 'Investments' | 'Savings';
export interface FundingAccount {
  id: string;
  name: string;
  role: 'Investments' | 'Savings' | 'spendable' | 'other';
}
export interface FundingTransaction {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  currency: string;
  type: Type;
  nature: Nature;
  transferId: string | null;
  note: string;
  eligible: boolean;
}
export interface FundingEntry {
  id: string;
  date: string;
  group: Role;
  label: string;
  amount: number;
  currency: string;
  note: string;
  destinationAccountId?: string;
}

const tracked = (role: FundingAccount['role'] | undefined): role is 'Investments' | 'Savings' =>
  role === 'Investments' || role === 'Savings';

// The same narrow brokerage names recognized by the principal reconciliation
// review. This describes a bank payment, never an assigned portfolio or trade.
const brokerage = /^(?:M1(?: FINANCE)?|PUBLIC(?:\.COM)?|ROBINHOOD(?: FINANCIAL| SECURITIES)?)$/i;

export function deriveFundingCalendar({ transactions, accounts, rules, ruleDestinations, from, to }: {
  transactions: FundingTransaction[];
  accounts: FundingAccount[];
  rules: PrincipalTransferRule[];
  ruleDestinations: FundingAccount[];
  from: string;
  to: string;
}): FundingEntry[] {
  const byId = new Map(accounts.map(a => [a.id, a]));
  const destinations = new Map(ruleDestinations.map(a => [a.id, a]));
  const pairs = new Map<string, FundingTransaction[]>();
  for (const tx of transactions) if (tx.transferId) {
    const rows = pairs.get(tx.transferId) ?? [];
    rows.push(tx);
    pairs.set(tx.transferId, rows);
  }
  const entries: FundingEntry[] = [];
  for (const tx of transactions) {
    if (!tx.eligible || tx.date < from || tx.date > to || !(tx.amount > 0)) continue;
    const source = byId.get(tx.accountId);
    if (!source) continue;
    const emit = (group: Role, label: string, amount: number, note: string, destinationAccountId?: string) =>
      entries.push({ id: tx.id, date: tx.date, group, label, amount, currency: tx.currency, note, destinationAccountId });
    if (tx.type === Type.income) {
      // Never count the receiving leg of a transfer or a brokerage dividend as pay.
      if (!tx.transferId && tx.nature === Nature.not_transfer && source.role === 'spendable')
        emit('Income', tx.note || source.name, tx.amount, 'Recorded income · ' + source.name);
      continue;
    }
    if (tx.type !== Type.expense || source.role === 'other') continue;
    if (isReturnOrAwardDescription(tx.note)) continue;
    if (tx.nature === Nature.transfer_to_portfolio && !tx.transferId) {
      if (source.role !== 'Investments')
        emit('Investments', tx.note || 'Portfolio contribution', tx.amount, 'Linked bank-to-portfolio transfer · ' + source.name);
      continue;
    }
    if (tx.transferId) {
      const legs = pairs.get(tx.transferId) ?? [];
      const opposite = legs.length === 2 ? legs.find(row => row.id !== tx.id && row.eligible && row.type === Type.income) : undefined;
      if (!opposite || tx.currency !== opposite.currency || tx.amount !== opposite.amount) continue;
      const destination = byId.get(opposite.accountId);
      if (destination && tracked(destination.role) && source.role !== destination.role)
        emit(destination.role, destination.name, tx.amount, 'Linked account transfer · ' + source.name, destination.id);
      else if (destination?.role === 'spendable' && tracked(source.role))
        emit(source.role, source.name, -tx.amount, 'Withdrawal to ' + destination.name);
      continue;
    }
    const { rule, conflicting } = selectPrincipalTransferRule(rules, tx.accountId, tx.note, tx.date);
    if (conflicting) continue;
    const destination = rule ? destinations.get(rule.destinationAccountId) : undefined;
    if (rule) {
      if (destination && tracked(destination.role) && source.role !== destination.role)
        emit(destination.role, destination.name, tx.amount, 'Confirmed bank transfer · ' + source.name);
      continue;
    }
    if (source.role === 'spendable' && [Nature.not_transfer, Nature.transfer_out_wallet].includes(tx.nature) && brokerage.test(tx.note.trim()))
      emit('Investments', tx.note.trim(), tx.amount, 'Recognized brokerage payment · portfolio assignment not verified');
  }
  return entries.sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
