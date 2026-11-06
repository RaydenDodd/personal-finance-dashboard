import type { CashFlowType, FinanceCashFlow } from './types';

export type PrincipalSource = 'manual' | 'google-sheets' | 'bank-transfer' | 'csv';
export type ContributionKind = 'employee' | 'employer' | 'unspecified';
export interface PrincipalImportRecord {
  accountId: string;
  date: string;
  amount: number;
  type: CashFlowType;
  toAccountId?: string | null;
  opening?: boolean;
  source: PrincipalSource;
  sourceId: string;
  sourceKey: string;
  description?: string;
  note?: string;
  verified: boolean;
  contributionKind?: ContributionKind;
  transactionIds?: string[];
  evidence?: Record<string, unknown>;
}
export interface PrincipalConflict {
  sourceId: string;
  sourceKey: string;
  reason: string;
  cashFlowId?: string;
}
export interface PrincipalImportResult {
  inserted: number;
  duplicate: number;
  corrected: number;
  linked: number;
  conflicts: PrincipalConflict[];
}
export interface PrincipalTransferRule {
  id: string;
  sourceNativeAccountId: string;
  destinationAccountId: string;
  exactDescription: string;
  effectiveFrom: string;
  isEnabled: boolean;
}
export interface PrincipalStoredFlow extends FinanceCashFlow {
  userId: number;
  amountCents: string | number;
  source: PrincipalSource;
  sourceId: string | null;
  sourceKey: string | null;
  sourceFingerprint: string | null;
  contributionKind: ContributionKind;
  verified: boolean;
  supersededAt: string | null;
  supersedesId: string | null;
}
