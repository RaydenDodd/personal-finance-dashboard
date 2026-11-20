import type { IncomePaycheck } from '@bt/shared/types/income-management';
import type { PayrollDashboard, PayrollImportResult, PayrollManagementInput } from '@bt/shared/types/payroll';

import { api } from './_api';

const base = '/personal-finance/income/payroll';
export interface PayrollQuery {
  from?: string;
  through?: string;
  employmentId?: string;
  aggregation?: 'paycheck' | 'monthly' | 'quarterly' | 'yearly';
}
export const getPayroll = (query: PayrollQuery = {}): Promise<PayrollDashboard> => api.get(base, query);
export const importPayroll = (input: {
  employmentId: string;
  source: 'adp';
  content: string;
  revision: number;
  previewOnly: boolean;
}): Promise<PayrollImportResult> => api.post(base + '/import', input);
export const savePayrollManagement = (input: PayrollManagementInput): Promise<PayrollDashboard> =>
  api.put(base + '/management', input);
export const linkPayrollDeposits = (input: {
  revision: number;
  statementId: string;
  depositIds: string[];
}): Promise<PayrollDashboard> => api.post(base + '/link', input);
export const parsePayrollPdf = (input: {
  employmentId: string;
  content: string;
}): Promise<{
  record: IncomePaycheck | null;
  issues: string[];
  requiresReview: boolean;
  documentHash: string;
  revision: number;
}> => api.post(base + '/parse-pdf', input);
export const importReviewedPayroll = (input: {
  employmentId: string;
  revision: number;
  record: IncomePaycheck;
  documentHash: string | null;
  previewOnly: boolean;
  reviewConfirmed: true;
}): Promise<PayrollImportResult> => api.post(base + '/manual', input);
export interface PayrollPrincipalPreview {
  employmentId: string;
  accountId: string;
  previewToken: string;
  previewOnly: boolean;
  coverageThrough: string | null;
  proposedCoverageThrough: string | null;
  totals: { employee: number; employer: number; total: number };
  actions: {
    date: string;
    amount: number;
    employee: number;
    employer: number;
    status: 'insert' | 'link' | 'duplicate' | 'update' | 'covered' | 'conflict';
    reason?: string;
  }[];
}
export const reconcilePayrollRetirement = (input: {
  employmentId: string;
  accountId: string;
  previewOnly: boolean;
  previewToken?: string;
}): Promise<PayrollPrincipalPreview> => api.post(base + '/retirement/reconcile', input);
