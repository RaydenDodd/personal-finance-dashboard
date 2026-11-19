import { validateTaxRuleSet, type TaxRuleSet } from '@bt/shared/finance-income';
import { z } from 'zod';

export const incomeDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
    'Use an actual calendar date',
  );
const money = z
  .number()
  .finite()
  .min(0)
  .max(1_000_000_000)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.0001, 'Use at most two decimal places');
const percent = z.number().finite().min(0).max(100);
const amount = z
  .object({
    kind: z.enum(['amount', 'percent']),
    value: z.number().finite().min(0).max(1_000_000_000),
    basis: z.enum(['gross', 'net', 'takeHome']).optional(),
  })
  .refine((a) => a.kind !== 'percent' || a.value <= 100, 'Percentage must be between 0 and 100');
export const incomePlanSchema = z.object({
  taxYear: z.number().int().min(1900).max(2200),
  filingStatus: z.enum(['single', 'married_joint', 'married_separate', 'head_household']),
  age: z.number().int().min(0).max(120),
  spouseAge: z.number().int().min(0).max(120).optional(),
  blind: z.boolean().optional(),
  spouseBlind: z.boolean().optional(),
  priorYearFicaWages: money.optional(),
  residenceState: z.enum(['VA', 'DC', 'MD', 'WV', 'NC']),
  employmentState: z.enum(['VA', 'DC', 'MD', 'WV', 'NC']).optional(),
  locality: z.string().max(100).optional(),
  dependents: z.number().int().min(0).max(100),
  childTaxCreditEligibleChildren: z.number().int().min(0).max(100).optional(),
  otherDependentCreditEligibleCount: z.number().int().min(0).max(100).optional(),
  spouseWagesIncluded: money.optional(),
  annualSalary: money,
  annualBonus: money,
  otherOrdinaryIncome: money.optional(),
  payFrequency: z.enum(['weekly', 'biweekly', 'semimonthly', 'monthly', 'annual']),
  traditional401k: amount,
  roth401k: amount,
  traditionalIra: amount,
  rothIra: amount,
  hsaAnnual: money,
  hsaCoverage: z.enum(['none', 'self', 'family']),
  hsaThroughPayroll: z.boolean(),
  hsaCompatibleFsa: z.boolean().optional(),
  deductions: z
    .array(
      z.object({
        id: z.string().max(100),
        name: z.string().min(1).max(120),
        annualAmount: money,
        kind: z.enum(['health', 'dental', 'vision', 'fsa', 'other']),
        reducesIncomeTax: z.boolean(),
        reducesFica: z.boolean(),
      }),
    )
    .max(50),
  coveredByWorkplacePlan: z.boolean(),
  spouseCoveredByWorkplacePlan: z.boolean().optional(),
  livedWithSpouse: z.boolean().optional(),
  employerMatchTiers: z
    .array(z.object({ employeePercent: percent, matchPercent: z.number().finite().min(0).max(1000) }))
    .max(20),
  employerBaseContributionPercent: percent,
  employerMatchEligibleBonus: z.boolean(),
  employerOtherContributionPercent: percent.optional(),
  employerOtherContributionName: z.string().max(150).optional(),
  investments: amount,
  savings: amount,
  savingsGoals: z
    .array(z.object({ id: z.string().max(100), name: z.string().min(1).max(120), percentOfSavings: percent }))
    .max(50)
    .optional(),
  deductionMethod: z.enum(['standard', 'itemized']),
  federalItemizedDeduction: money,
  stateItemizedDeduction: money.optional(),
  federalAdjustments: money.optional(),
  stateAdjustments: money.optional(),
  federalCredits: money.optional(),
  stateCredits: money.optional(),
  stateTaxableIncomeOverride: money.optional(),
  localAnnualTaxOverride: money.optional(),
  actualFederalWithholding: money.optional(),
  actualStateWithholding: money.optional(),
  actualLocalWithholding: money.optional(),
  actualSocialSecurityWithholding: money.optional(),
  actualMedicareWithholding: money.optional(),
  iraModifiedAgiOverride: money.optional(),
  allowEstimatedYear: z.boolean().optional(),
  customRules: z
    .custom<TaxRuleSet>((value) => {
      try {
        return validateTaxRuleSet(value as TaxRuleSet).length === 0;
      } catch {
        return false;
      }
    }, 'Provide a fully validated, sourced year-specific tax rule set')
    .optional(),
});
export const employerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  person: z.string().trim().max(150),
  kind: z.enum(['employment', 'side-income']),
  startDate: incomeDate.nullable(),
  endDate: incomeDate.nullable(),
});
export const paycheckSchema = z
  .object({
    id: z.string().uuid(),
    employerId: z.string().uuid(),
    date: incomeDate,
    periodStart: incomeDate.nullable(),
    periodEnd: incomeDate.nullable(),
    evidence: z.enum(['actual', 'estimated', 'projected']),
    gross: money.nullable(),
    bonus: money,
    net: money,
    federal: money,
    state: money,
    local: money,
    socialSecurity: money,
    medicare: money,
    employerContributions: money,
    withholdingComplete: z.boolean().default(false),
    deductions: z
      .array(z.object({ name: z.string().min(1).max(150), amount: money, treatment: z.enum(['pre-tax', 'post-tax']) }))
      .max(50),
    nativeTransactionId: z.string().uuid().nullable(),
    source: z.enum(['manual', 'csv', 'pdf']),
    sourceKey: z.string().max(300).nullable(),
    notes: z.string().max(5000),
  })
  .refine((p) => p.gross === null || p.bonus <= p.gross, 'Bonus is a portion of gross wages; it cannot exceed gross');
export const incomeVersionSchema = z.object({
  id: z.string().uuid(),
  employerId: z.string().uuid().nullable(),
  name: z.string().min(1).max(200),
  effectiveFrom: incomeDate.nullable(),
  effectiveTo: incomeDate.nullable(),
  evidence: z.enum(['estimated', 'projected']),
  input: incomePlanSchema,
  notes: z.string().max(5000),
});
export const projectionInputSchema = z.object({
  years: z.number().int().min(1).max(80),
  startingBalance: money,
  annualContribution: money,
  contributionFrequency: z.enum(['biweekly', 'monthly', 'annual']),
  annualReturnPercent: z.number().finite().gt(-100).max(1000),
  salaryGrowthPercent: z.number().finite().min(-100).max(1000),
  inflationPercent: z.number().finite().gt(-100).max(1000),
});
export const incomeDocumentSchema = z.object({
  revision: z.number().int().min(0),
  employers: z.array(employerSchema).max(200),
  paychecks: z.array(paycheckSchema).max(10000),
  plans: z.array(incomeVersionSchema).max(1000),
  projections: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(150),
        input: projectionInputSchema,
        notes: z.string().max(2000),
      }),
    )
    .max(100)
    .optional(),
});
