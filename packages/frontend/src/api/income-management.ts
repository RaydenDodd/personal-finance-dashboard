import { api } from '@/api/_api';
import type { IncomePlanInput, IncomePlanResult, TaxRuleSet } from '@bt/shared/finance-income';
import type { IncomeDashboard, IncomeDocument, IncomePaycheck } from '@bt/shared/types/income-management';

const base = '/personal-finance/income';
export const getIncomeDashboard = (
  from?: string,
  through?: string,
  granularity: 'biweekly' | 'monthly' | 'yearly' = 'monthly',
): Promise<IncomeDashboard> => api.get(base, { from, through, granularity });
export const saveIncomeDocument = (document: IncomeDocument): Promise<IncomeDocument> => api.put(base, document);
export const calculateIncomePlan = (input: IncomePlanInput): Promise<IncomePlanResult> =>
  api.post(base + '/calculate', input);
export const importIncome = (
  records: IncomePaycheck[],
  revision: number,
  previewOnly: boolean,
): Promise<{
  inserted: number;
  duplicates: number;
  conflicts: number;
  previewOnly: boolean;
  records: IncomePaycheck[];
}> => api.post(base + '/import', { records, revision, previewOnly });
export const parseIncomeFile = (
  employerId: string,
  type: 'csv' | 'pdf',
  content: string,
): Promise<{
  type: 'csv' | 'pdf';
  records?: IncomePaycheck[];
  record?: IncomePaycheck;
  issues: string[];
  requiresReview?: boolean;
  text?: string;
}> => api.post(base + '/parse', { employerId, type, content });
export const getIncomeTaxData = (): Promise<{
  rules: TaxRuleSet[];
  latestCheck: { createdAt: string; details: { sources: { url: string; status: string; changed: boolean }[] } } | null;
  policy: string;
}> => api.get(base + '/tax-data');
export const refreshIncomeTaxData = (): Promise<unknown> => api.post(base + '/tax-data/refresh');
