/** Actual payroll values are signed USD amounts, never cumulative YTD values. */
export type PayrollFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'annual';
export type PayrollCategory =
  | 'net'
  | 'federal'
  | 'state'
  | 'local'
  | 'socialSecurity'
  | 'medicare'
  | 'roth401k'
  | 'traditional401k'
  | 'benefits'
  | 'other'
  | 'noncash'
  | 'unallocated'
  | 'employerRetirement';
export interface PayrollEmployment {
  id: string;
  employerName: string;
  jobTitle: string;
  startDate: string | null;
  endDate: string | null;
  positionStartDate: string | null;
  positionEndDate: string | null;
  status: 'current' | 'previous';
  source: string;
  payFrequency: PayrollFrequency;
  compensationType: 'salary' | 'hourly';
  annualHours: number | null;
  manualAnnualSalary: number | null;
  notes: string;
}
export interface PayrollLine {
  code: string;
  name: string;
  amount: number | null;
  ytd: number | null;
  category: string;
  preTax: boolean | null;
  hours?: number | null;
  rate?: number | null;
}
export interface PayrollTotals {
  gross: number;
  net: number;
  regular: number;
  additional: number;
  bonus: number;
  noncashEarnings: number;
  federal: number;
  state: number;
  local: number;
  socialSecurity: number;
  medicare: number;
  employeeRetirement: number;
  employerMatch: number;
  employerOtherRetirement: number;
  employerRetirement: number;
  benefits: number;
  otherDeductions: number;
  noncashOffsets: number;
  totalCompensation: number;
}
export interface PayrollStatement {
  id: string;
  employmentId: string;
  source: string;
  statementId: string;
  payDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  adjustment: boolean;
  currency: 'USD';
  hours: number | null;
  regularRate: number | null;
  annualizedSalary: number | null;
  earnings: PayrollLine[];
  deductions: PayrollLine[];
  memos: PayrollLine[];
  totals: PayrollTotals;
  allocations: Record<PayrollCategory, number>;
  grossYtd: number | null;
  issues: string[];
  version: number;
  importedAt: string;
  sourceHash: string;
  depositIds: string[];
  incompleteFields?: string[];
}
export interface PayrollSalaryEvent {
  id: string;
  employmentId: string;
  date: string;
  effectiveDate: string | null;
  firstObservedDate: string;
  periodStart: string | null;
  employerName: string;
  jobTitle: string;
  salary: number;
  previousSalary: number | null;
  change: number | null;
  changePercent: number | null;
  regularRate: number | null;
  source: 'payroll' | 'manual';
  kind: 'starting' | 'raise' | 'decrease' | 'promotion' | 'employment' | 'correction';
  notes: string;
  confirmed: boolean;
}
export interface PayrollSettings {
  reminderDays: number;
  snoozedUntil: string | null;
  reminderDismissed: boolean;
}
export interface PayrollImportRun {
  id: string;
  at: string;
  source: string;
  employmentId: string;
  inserted: number;
  updated: number;
  duplicates: number;
  rejected: number;
  issues: string[];
  fileHash: string;
}
export interface PayrollStatus {
  connectionStatus: 'assisted-export';
  lastSuccessfulSync: string | null;
  lastSuccessfulImport: string | null;
  latestPaycheck: string | null;
  statementCount: number;
  reminderDue: boolean;
  settings: PayrollSettings;
  history: PayrollImportRun[];
}
export interface PayrollPeriod extends PayrollTotals {
  date: string;
  through: string;
  statementIds: string[];
  allocations: Record<PayrollCategory, number>;
  incomplete: boolean;
  previousGross: number | null;
  change: number | null;
  changePercent: number | null;
}
export interface PayrollReconciliation {
  statementId: string;
  linkedDepositIds: string[];
  candidates: { id: string; date: string; amount: number; accountId: string; description: string }[];
  status: 'linked' | 'candidate' | 'unmatched' | 'zero-net';
}
export interface PayrollDashboard {
  revision: number;
  employments: PayrollEmployment[];
  statements: PayrollStatement[];
  salaryEvents: PayrollSalaryEvent[];
  manualSalaryEvents: PayrollSalaryEvent[];
  summary: PayrollTotals & {
    from: string;
    through: string;
    count: number;
    currentSalary: number | null;
    currentEmployer: string | null;
    currentJobTitle: string | null;
    startingSalary: number | null;
    previousSalary: number | null;
    salaryGrowth: number | null;
    salaryGrowthPercent: number | null;
    lastRaiseDate: string | null;
    coverageFrom: string | null;
    coverageThrough: string | null;
    positionStartingSalary?: number | null;
    currentPositionGrowth?: number | null;
    currentPositionGrowthPercent?: number | null;
    employmentDurationDays?: number | null;
    daysSinceRaise?: number | null;
    yearOverYearGrowth?: number | null;
    yearOverYearGrowthPercent?: number | null;
    allTimeSalaryGrowth?: number | null;
    allTimeSalaryGrowthPercent?: number | null;
  };
  received: PayrollPeriod[];
  reconciliation: PayrollReconciliation[];
  status: PayrollStatus;
  issues: string[];
}
export interface PayrollImportResult {
  inserted: number;
  updated: number;
  duplicates: number;
  rejected: number;
  issues: string[];
  previewOnly: boolean;
  revision: number;
  statements: PayrollStatement[];
}
export interface PayrollManagementInput {
  revision: number;
  employments: PayrollEmployment[];
  manualSalaryEvents: PayrollSalaryEvent[];
  settings: PayrollSettings;
}
