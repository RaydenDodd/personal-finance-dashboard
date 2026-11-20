import type { IncomePlanInput, IncomePlanResult } from '../finance-income';
import type { WealthProjectionInput } from '../finance-income';

export type IncomeEvidence = 'actual' | 'estimated' | 'projected';
export interface IncomeEmployer {
  id: string;
  name: string;
  person: string;
  kind: 'employment' | 'side-income';
  startDate: string | null;
  endDate: string | null;
}
export interface IncomePaycheck {
  id: string;
  employerId: string;
  date: string;
  periodStart: string | null;
  periodEnd: string | null;
  evidence: IncomeEvidence;
  gross: number | null;
  bonus: number;
  net: number;
  federal: number;
  state: number;
  local: number;
  socialSecurity: number;
  medicare: number;
  employerContributions: number;
  withholdingComplete: boolean;
  deductions: { name: string; amount: number; treatment: 'pre-tax' | 'post-tax' }[];
  nativeTransactionId: string | null;
  source: 'manual' | 'csv' | 'pdf';
  sourceKey: string | null;
  notes: string;
}
export interface IncomePlanVersion {
  id: string;
  employerId: string | null;
  name: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  evidence: 'estimated' | 'projected';
  input: IncomePlanInput;
  notes: string;
}
export interface IncomeDocument {
  revision: number;
  employers: IncomeEmployer[];
  paychecks: IncomePaycheck[];
  plans: IncomePlanVersion[];
  projections?: { id: string; name: string; input: WealthProjectionInput; notes: string }[];
}
export interface BankIncomeRow {
  id: string;
  date: string;
  amount: number;
  accountId: string;
  description: string;
}
export interface IncomePeriod {
  date: string;
  bankNet: number;
  manualNet: number;
  actualNet: number;
  gross: number | null;
  bonus: number | null;
  employerContributions: number | null;
  federal: number | null;
  state: number | null;
  local: number | null;
  socialSecurity: number | null;
  medicare: number | null;
  unknownGrossCount: number;
}
export interface IncomeDashboard {
  document: IncomeDocument;
  bankIncome: BankIncomeRow[];
  reconciliation: { paycheckId: string; candidates: BankIncomeRow[] }[];
  periods: IncomePeriod[];
  currentBehavior: {
    basis: string;
    from: string;
    through: string;
    bankNetIncome: number;
    actualIncome: number;
    unmatchedManualNet: number;
    heldForReconciliation: number;
    grossKnown: number | null;
  };
  calculations: { plan: IncomePlanVersion; result: IncomePlanResult }[];
}

export interface IncomePlanPace {
  from: string;
  through: string;
  today: string;
  coverageFrom: string | null;
  planName: string | null;
  planBasis: string;
  savingsBasis: string;
  points: {
    date: string;
    income: number | null;
    savings: number | null;
    plannedIncome: number | null;
    plannedSavings: number | null;
  }[];
  funding: { id: string; date: string; amount: number; accountId: string; description: string }[];
}
