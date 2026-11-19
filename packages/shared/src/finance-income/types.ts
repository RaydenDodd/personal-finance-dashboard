export type FilingStatus = 'single' | 'married_joint' | 'married_separate' | 'head_household';
export type SupportedState = 'VA' | 'DC' | 'MD' | 'WV' | 'NC';
export interface AmountInput {
  kind: 'amount' | 'percent';
  value: number;
  basis?: 'gross' | 'net' | 'takeHome';
}
export interface PayrollDeduction {
  id: string;
  name: string;
  annualAmount: number;
  kind: 'health' | 'dental' | 'vision' | 'fsa' | 'other';
  reducesIncomeTax: boolean;
  reducesFica: boolean;
}
export interface EmployerMatchTier {
  employeePercent: number;
  matchPercent: number;
}
export interface IncomePlanInput {
  /** Age 0 means unknown: no age-based deduction or catch-up is inferred. */
  taxYear: number;
  filingStatus: FilingStatus;
  age: number;
  spouseAge?: number;
  blind?: boolean;
  spouseBlind?: boolean;
  priorYearFicaWages?: number;
  residenceState: SupportedState;
  employmentState?: SupportedState;
  locality?: string;
  dependents: number;
  childTaxCreditEligibleChildren?: number;
  otherDependentCreditEligibleCount?: number;
  spouseWagesIncluded?: number;
  annualSalary: number;
  annualBonus: number;
  otherOrdinaryIncome?: number;
  payFrequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'annual';
  traditional401k: AmountInput;
  roth401k: AmountInput;
  traditionalIra: AmountInput;
  rothIra: AmountInput;
  hsaAnnual: number;
  hsaCoverage: 'none' | 'self' | 'family';
  hsaThroughPayroll: boolean;
  hsaCompatibleFsa?: boolean;
  deductions: PayrollDeduction[];
  coveredByWorkplacePlan: boolean;
  spouseCoveredByWorkplacePlan?: boolean;
  livedWithSpouse?: boolean;
  employerMatchTiers: EmployerMatchTier[];
  employerBaseContributionPercent: number;
  employerMatchEligibleBonus: boolean;
  employerOtherContributionPercent?: number;
  employerOtherContributionName?: string;
  investments: AmountInput;
  savings: AmountInput;
  savingsGoals?: Array<{ id: string; name: string; percentOfSavings: number }>;
  deductionMethod: 'standard' | 'itemized';
  federalItemizedDeduction: number;
  stateItemizedDeduction?: number;
  federalAdjustments?: number;
  stateAdjustments?: number;
  federalCredits?: number;
  stateCredits?: number;
  /** Only verified manual values, not guessed amounts. Overrides a rule calculation and is explicitly labelled. */
  stateTaxableIncomeOverride?: number;
  localAnnualTaxOverride?: number;
  actualFederalWithholding?: number;
  actualStateWithholding?: number;
  actualLocalWithholding?: number;
  actualSocialSecurityWithholding?: number;
  actualMedicareWithholding?: number;
  iraModifiedAgiOverride?: number;
  allowEstimatedYear?: boolean;
  /** Explicit tax-year values for scenarios with unavailable published rules. */
  customRules?: TaxRuleSet;
}
export interface Bracket {
  upTo: number | null;
  rate: number;
}
export interface TaxSource {
  title: string;
  url: string;
  checkedAt: string;
}
export interface StateRules {
  brackets: Record<FilingStatus, Bracket[]>;
  standardDeduction: Record<FilingStatus, number>;
  personalExemption?: number;
  requiresTaxableOverride?: boolean;
  sources: TaxSource[];
}
export interface TaxRuleSet {
  taxYear: number;
  status: 'published' | 'estimated';
  checkedAt: string;
  federalBrackets: Record<FilingStatus, Bracket[]>;
  federalStandardDeduction: Record<FilingStatus, number>;
  additionalStandardDeduction: { unmarried: number; married: number };
  seniorDeduction: {
    firstYear: number;
    lastYear: number;
    amount: number;
    phaseoutRate: number;
    singleThreshold: number;
    jointThreshold: number;
  };
  dependentCredits: { child: number; other: number; phaseoutSingle: number; phaseoutJoint: number };
  rothCatchupPriorYearWageThreshold: number;
  socialSecurityWageBase: number;
  socialSecurityRate: number;
  medicareRate: number;
  additionalMedicareRate: number;
  additionalMedicareThreshold: Record<FilingStatus, number>;
  limits: {
    employee401k: number;
    catchup401k: number;
    catchup401k60to63: number;
    combined401k: number;
    ira: number;
    catchupIra: number;
    hsaSelf: number;
    hsaFamily: number;
    hsaCatchup: number;
    healthFsa: number;
  };
  iraPhaseouts: {
    traditionalSingle: [number, number];
    traditionalJoint: [number, number];
    traditionalSpouse: [number, number];
    rothSingle: [number, number];
    rothJoint: [number, number];
  };
  states: Record<SupportedState, StateRules>;
  sources: TaxSource[];
}
export interface PeriodAmounts {
  biweekly: number;
  monthly: number;
  yearly: number;
}
export interface IncomeBreakdownRow extends PeriodAmounts {
  id: string;
  group: string;
  label: string;
  subtotal?: boolean;
  note?: string;
}
export interface AllocationRow extends PeriodAmounts {
  id: string;
  label: string;
  percent: number;
}
export interface IncomeFlowNode {
  id: string;
  name: string;
  amount: number;
  percentOfTotal: number;
  percentOfParent: number;
  children?: IncomeFlowNode[];
}
export interface IncomePlanResult {
  available: boolean;
  taxYear: number;
  ruleStatus: 'published' | 'estimated' | 'unavailable';
  warnings: string[];
  sources: TaxSource[];
  annual: {
    gross: number;
    salary: number;
    bonus: number;
    employerMatch: number;
    employerOtherContribution: number;
    totalComp: number;
    federalTax: number | null;
    stateTax: number | null;
    localTax: number | null;
    socialSecurity: number | null;
    medicare: number | null;
    additionalMedicare: number | null;
    taxes: number | null;
    federalTaxableIncome: number | null;
    stateTaxableIncome: number | null;
    ficaWages: number;
    net: number | null;
    takeHome: number | null;
    afterIra: number | null;
    spendable: number | null;
    traditional401k: number;
    roth401k: number;
    traditionalIra: number;
    rothIra: number;
    deductibleTraditionalIra: number;
    permittedRothIra: number | null;
    hsa: number;
    otherPreTaxDeductions: number;
    otherPostTaxDeductions: number;
    investments: number | null;
    savings: number | null;
    retirement: number;
  };
  /** Marginal rates are fractions (0.22); effective rates are percentage points (22). */
  rates: {
    federalMarginal: number | null;
    stateMarginal: number | null;
    federalEffective: number | null;
    totalEffective: number | null;
  };
  withholding: {
    actualIncomeTax: number | null;
    estimatedIncomeTax: number | null;
    projectedRefund: number | null;
    projectedOwed: number | null;
  };
  limits: TaxRuleSet['limits'] | null;
  breakdown: IncomeBreakdownRow[];
  allocations: AllocationRow[];
  flow: IncomeFlowNode | null;
  savingsInvestmentsRetirementPercent: number | null;
  allocationPercentages: {
    investments: { gross: number; net: number; takeHome: number };
    savings: { gross: number; net: number; takeHome: number };
  } | null;
  averages: { periodsPerYear: number; takeHomePerPaycheck: number | null; note: string };
}
