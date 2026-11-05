export interface FinanceCategory {
  id: string;
  name: string;
  color: string;
}
export const DEFAULT_CATEGORIES: FinanceCategory[] = [
  { id: 'spendable', name: 'Spendable Money', color: '#3b82f6' },
  { id: 'savings', name: 'Savings', color: '#10b981' },
  { id: 'investments', name: 'Investments', color: '#8b5cf6' },
  { id: 'retirement', name: 'Retirement', color: '#f59e0b' },
];
export type FinanceSource = 'manual' | 'google-sheets' | 'csv' | 'simplefin' | 'plaid';
export interface FinanceAccount {
  id: string;
  userId: number;
  name: string;
  currencyCode: string;
  categoryId: string;
  included: boolean;
  balanceKind: 'asset' | 'liability';
  nativeAccountId: string | null;
  nativeAccountIds?: string[];
  preferredSource: FinanceSource;
  description: string;
  createdAt: string;
}
export interface FinanceSnapshot {
  revision?: number;
  id: string;
  accountId: string;
  date: string;
  balance: number;
  currencyCode: string;
  source: FinanceSource;
  verified: boolean;
  sourceId: string;
  sourceKey: string;
  sourceLabel: string;
  formula: string | null;
  description: string;
  createdAt: string;
}
export type CashFlowType = 'contribution' | 'withdrawal' | 'transfer' | 'adjustment' | 'interest' | 'dividend';
export interface FinanceCashFlow {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  type: CashFlowType;
  toAccountId: string | null;
  description: string;
  opening: boolean;
  createdAt: string;
}
export interface ImportRecord {
  sourceKey: string;
  accountId: string;
  date: string;
  balance: number;
  currencyCode: string;
  sourceLabel?: string;
  formula?: string | null;
  verified?: boolean;
}
export interface ImportRequest {
  sourceId: string;
  source?: 'google-sheets' | 'csv';
  records: ImportRecord[];
  previewToken?: string;
}
export interface HistoryPoint {
  date: string;
  total: number | null;
  knownTotal: number;
  categories: Record<string, number>;
  missingAccountIds: string[];
  complete: boolean;
  balances: Record<string, number | null>;
  valuationDates: Record<string, string | null>;
}
