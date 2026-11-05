import { api } from '@/api/_api';

export interface FinanceCategory {
  id: string;
  name: string;
  color: string;
}
export interface FinanceAccount {
  id: string;
  name: string;
  currencyCode: string;
  categoryId: string;
  included: boolean;
  balanceKind: 'asset' | 'liability';
  nativeAccountId: string | null;
  nativeAccountIds?: string[];
  preferredSource: string;
  latestBalance: number | null;
  valuationDate: string | null;
  principal: number | null;
  principalComplete?: boolean;
  contributions: number;
  withdrawals: number;
  interest: number;
  gain: number | null;
  gainPercent: number | null;
  moneyWeightedReturnPercent?: number | null;
  staleDays?: number | null;
  lastSuccessfulSyncAt?: string | null;
  connectionStatus?: 'manual' | 'connected' | 'disconnected';
  valuationSource?: string | null;
  verified?: boolean;
}
export interface FinanceHistoryPoint {
  date: string;
  total: number | null;
  knownTotal: number;
  categories: Record<string, number>;
  missingAccountIds: string[];
  inactiveAccountIds?: string[];
  complete: boolean;
  balances: Record<string, number | null>;
  valuationDates?: Record<string, string | null>;
}
export type CashFlowType = 'contribution' | 'withdrawal' | 'transfer' | 'adjustment' | 'interest' | 'dividend';
export interface FinanceCashFlow {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  type: CashFlowType;
  toAccountId?: string | null;
  description?: string;
  opening?: boolean;
}
export interface FinanceDashboard {
  currencyCode: string;
  asOf: string | null;
  complete: boolean;
  knownTotal: number;
  categories: FinanceCategory[];
  accounts: FinanceAccount[];
  history: FinanceHistoryPoint[];
  cashFlows: FinanceCashFlow[];
  snapshots?: Array<{
    accountId: string;
    date: string;
    balance: number;
    currencyCode: string;
    source?: string;
    verified?: boolean;
    formula?: string | null;
  }>;
  snapshotCount: number;
  total: number | null;
  highest: number | null;
  monthlyChange: number | { amount: number; percent?: number | null } | null;
  yearlyChange: number | { amount: number; percent?: number | null } | null;
}
export interface HistoryImportRecord {
  sourceKey: string;
  accountId: string;
  date: string;
  balance: number;
  currencyCode: string;
  sourceLabel?: string;
  formula?: string;
  verified?: boolean;
}
export interface HistoryImportPayload {
  sourceId: string;
  source?: 'csv' | 'google-sheets';
  records: HistoryImportRecord[];
}
export interface HistoryImportPreview {
  previewToken: string;
  records: Array<HistoryImportRecord & { action: 'insert' | 'duplicate' | 'protected' }>;
  counts: { insert: number; duplicate: number; protected: number };
  warnings: string[];
}

export const getPersonalFinanceDashboard = (query: {
  from?: string;
  to?: string;
  granularity: 'daily' | 'monthly';
  mode?: 'all' | 'personal';
}): Promise<FinanceDashboard> => api.get('/personal-finance/dashboard', query);
export const saveFinanceCategories = (categories: FinanceCategory[]) =>
  api.put('/personal-finance/categories', { categories });
export const saveFinanceAccount = (account: Partial<FinanceAccount>) =>
  account.id
    ? api.put(`/personal-finance/accounts/${account.id}`, account)
    : api.post('/personal-finance/accounts', account);
export const saveFinanceSnapshot = (snapshot: {
  accountId: string;
  date: string;
  balance: number;
  source: 'manual';
  verified: true;
  description?: string;
}) => api.post('/personal-finance/snapshots', snapshot);
export const saveFinanceCashFlow = (flow: Omit<FinanceCashFlow, 'id'>) =>
  api.post('/personal-finance/cash-flows', flow);
export const previewFinanceImport = (payload: HistoryImportPayload): Promise<HistoryImportPreview> =>
  api.post('/personal-finance/import/preview', payload);
export const commitFinanceImport = (payload: HistoryImportPayload & { previewToken: string }) =>
  api.post('/personal-finance/import/commit', payload);
