import { MARYLAND_LOCAL_RATES_2026, TAX_RULES_2026 } from './rules-2026';
import type {
  AllocationRow,
  AmountInput,
  Bracket,
  FilingStatus,
  IncomeBreakdownRow,
  IncomeFlowNode,
  IncomePlanInput,
  IncomePlanResult,
  TaxRuleSet,
} from './types';
import { validateTaxRuleSet } from './validate-rules';

export const roundMoney = (amount: number): number => {
  const absolute = Math.abs(amount);
  const rounded = Math.round((absolute + Number.EPSILON * Math.max(1, absolute)) * 100) / 100;
  return rounded === 0 ? 0 : Math.sign(amount) * rounded;
};
const nonnegative = (amount: number | undefined): number => (Number.isFinite(amount) ? Math.max(0, amount!) : 0);
const pct = (part: number, whole: number): number => (whole > 0 ? (part / whole) * 100 : 0);
const periods = (yearly: number) => ({
  yearly: roundMoney(yearly),
  monthly: roundMoney(yearly / 12),
  biweekly: roundMoney(yearly / 26),
});
const isJoint = (status: FilingStatus) => status === 'married_joint';

export function progressiveTax(income: number, brackets: Bracket[]): { tax: number; marginalRate: number } {
  const taxable = nonnegative(income);
  let lower = 0,
    tax = 0,
    marginalRate = 0;
  for (const bracket of brackets) {
    const upper = bracket.upTo ?? Infinity;
    if (taxable > lower) {
      tax += Math.max(0, Math.min(taxable, upper) - lower) * bracket.rate;
      marginalRate = bracket.rate;
    }
    if (taxable <= upper) break;
    lower = upper;
  }
  return { tax: roundMoney(tax), marginalRate };
}

export function resolveAmount(input: AmountInput, bases: { gross: number; net: number; takeHome: number }): number {
  if (!Number.isFinite(input.value) || input.value < 0)
    throw new Error('Allocation inputs must be finite and nonnegative.');
  return roundMoney(input.kind === 'amount' ? input.value : (bases[input.basis ?? 'gross'] * input.value) / 100);
}

export function createDefaultIncomePlan(): IncomePlanInput {
  return {
    taxYear: 2026,
    filingStatus: 'single',
    age: 0,
    residenceState: 'VA',
    employmentState: 'VA',
    dependents: 0,
    annualSalary: 0,
    annualBonus: 0,
    payFrequency: 'biweekly',
    traditional401k: { kind: 'percent', value: 0, basis: 'gross' },
    roth401k: { kind: 'percent', value: 0, basis: 'gross' },
    traditionalIra: { kind: 'amount', value: 0 },
    rothIra: { kind: 'amount', value: 0 },
    hsaAnnual: 0,
    hsaCoverage: 'none',
    hsaThroughPayroll: true,
    deductions: [],
    coveredByWorkplacePlan: true,
    employerMatchTiers: [],
    employerBaseContributionPercent: 0,
    employerMatchEligibleBonus: true,
    employerOtherContributionPercent: 0,
    employerOtherContributionName: 'Other employer retirement contribution',
    investments: { kind: 'percent', value: 0, basis: 'takeHome' },
    savings: { kind: 'percent', value: 0, basis: 'takeHome' },
    deductionMethod: 'standard',
    federalItemizedDeduction: 0,
  };
}

function contribution(input: AmountInput, gross: number): number {
  if (input.kind === 'percent' && input.basis && input.basis !== 'gross')
    throw new Error('Retirement contribution percentages use gross compensation.');
  return resolveAmount(input, { gross, net: gross, takeHome: gross });
}

function phaseoutLimit(limit: number, magi: number, range: [number, number]): number {
  if (magi <= range[0]) return limit;
  if (magi >= range[1]) return 0;
  return Math.min(limit, Math.max(200, Math.ceil((limit * (range[1] - magi)) / (range[1] - range[0]) / 10) * 10));
}

function localTaxMd(taxable: number, locality: string | undefined, filing: FilingStatus): number | null {
  const key = (locality ?? '')
    .toLowerCase()
    .replace(/county|[^a-z]/g, '')
    .replace(/^st(?=marys)/, 'saint');
  const fixed = MARYLAND_LOCAL_RATES_2026[key];
  if (fixed !== undefined) return roundMoney(taxable * fixed);
  const joint = filing === 'married_joint' || filing === 'head_household';
  if (key === 'annearundel')
    return progressiveTax(taxable, [
      { upTo: joint ? 75000 : 50000, rate: 0.027 },
      { upTo: joint ? 480000 : 400000, rate: 0.0294 },
      { upTo: null, rate: 0.032 },
    ]).tax;
  if (key === 'frederick')
    return progressiveTax(taxable, [
      { upTo: 25000, rate: 0.0225 },
      { upTo: joint ? 100000 : 50000, rate: 0.0275 },
      { upTo: joint ? 250000 : 150000, rate: 0.0296 },
      { upTo: null, rate: 0.032 },
    ]).tax;
  return null;
}

function canUseResidenceOnly(residence: string, employment: string): boolean {
  if (residence === employment || employment === 'DC') return true;
  const pairs = new Set(['VA:MD', 'MD:VA', 'VA:WV', 'WV:VA', 'MD:WV', 'WV:MD', 'DC:MD', 'DC:VA', 'DC:WV']);
  return pairs.has(`${residence}:${employment}`);
}

export function calculateIncomePlan(input: IncomePlanInput): IncomePlanResult {
  const warnings: string[] = [];
  if (input.age === 0)
    warnings.push('Age is not supplied; age-related additional deductions and contribution catch-ups are not assumed.');
  const finite = [
    input.annualSalary,
    input.annualBonus,
    input.age,
    input.dependents,
    input.hsaAnnual,
    input.federalItemizedDeduction,
  ];
  if (finite.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error('Salary, ages, dependents and deductions must be finite and nonnegative.');
  if (!Number.isInteger(input.taxYear) || !Number.isInteger(input.dependents))
    throw new Error('Tax year and dependent count must be whole numbers.');
  let rules: TaxRuleSet | null = input.customRules ?? (input.taxYear === 2026 ? TAX_RULES_2026 : null);
  if (!rules && input.taxYear > 2026 && input.allowEstimatedYear) {
    rules = { ...TAX_RULES_2026, taxYear: input.taxYear, status: 'estimated' };
    warnings.push(
      `Future scenario explicitly freezes validated 2026 brackets, deductions and limits for ${input.taxYear}; these are not published ${input.taxYear} rules. Refresh the cached rule set before relying on a future-year tax estimate.`,
    );
  }
  if (rules && rules.taxYear !== input.taxYear) throw new Error('Tax-rule year must match the selected tax year.');
  if (rules) {
    const errors = validateTaxRuleSet(rules);
    if (errors.length) throw new Error(errors.join(' '));
  }
  if (rules?.status === 'estimated')
    warnings.push('These are explicitly estimated scenario rules, not published tax rules.');
  if (!rules)
    warnings.push(
      `Published tax rules for ${input.taxYear} are unavailable. Historical values were not replaced with another year's rules.`,
    );
  const salary = roundMoney(input.annualSalary),
    bonus = roundMoney(input.annualBonus);
  const wages = salary + bonus,
    gross = roundMoney(wages + nonnegative(input.otherOrdinaryIncome));
  if (input.otherOrdinaryIncome)
    warnings.push(
      'Other ordinary income is treated as non-wage income. Self-employment tax and capital-gain treatment require separate verified inputs.',
    );
  let traditional401k = contribution(input.traditional401k, wages),
    roth401k = contribution(input.roth401k, wages);
  const requested401 = traditional401k + roth401k;
  const catchup =
    !rules || input.age < 50
      ? 0
      : input.age >= 60 && input.age <= 63
        ? rules.limits.catchup401k60to63
        : rules.limits.catchup401k;
  const employeeLimit = rules ? Math.min(wages, rules.limits.employee401k + catchup) : requested401;
  if (requested401 > employeeLimit && requested401 > 0) {
    const factor = employeeLimit / requested401;
    traditional401k = roundMoney(traditional401k * factor);
    roth401k = roundMoney(employeeLimit - traditional401k);
    warnings.push(
      'Requested Traditional/Roth 401(k) contributions exceed the shared employee limit; the calculation caps them proportionally without changing saved inputs.',
    );
  }
  if (
    rules &&
    input.age >= 50 &&
    input.priorYearFicaWages !== undefined &&
    input.priorYearFicaWages > rules.rothCatchupPriorYearWageThreshold &&
    traditional401k > rules.limits.employee401k
  ) {
    const excess = traditional401k - rules.limits.employee401k;
    traditional401k -= excess;
    roth401k += excess;
    warnings.push(
      'For the supplied prior-year FICA wages, catch-up 401(k) contributions are treated as Roth under the 2026 high-earner rule. Confirm plan availability.',
    );
  } else if (
    input.age >= 50 &&
    catchup > 0 &&
    input.priorYearFicaWages === undefined &&
    requested401 > (rules?.limits.employee401k ?? Infinity)
  ) {
    warnings.push('Prior-year FICA wages are needed to determine whether 2026 catch-up contributions must be Roth.');
  }
  const total401 = traditional401k + roth401k;
  const matchWages = salary + (input.employerMatchEligibleBonus ? bonus : 0);
  const employeePct = matchWages > 0 ? (total401 / matchWages) * 100 : 0;
  let remaining = employeePct,
    employerMatch = (matchWages * nonnegative(input.employerBaseContributionPercent)) / 100;
  for (const tier of input.employerMatchTiers) {
    if (![tier.employeePercent, tier.matchPercent].every((v) => Number.isFinite(v) && v >= 0))
      throw new Error('Employer match tiers must be finite and nonnegative.');
    const matched = Math.min(remaining, tier.employeePercent);
    employerMatch += (((matchWages * matched) / 100) * tier.matchPercent) / 100;
    remaining = Math.max(0, remaining - matched);
  }
  employerMatch = roundMoney(employerMatch);
  const employerOtherContribution = roundMoney(
    (matchWages * nonnegative(input.employerOtherContributionPercent)) / 100,
  );
  if (
    rules &&
    total401 - Math.min(catchup, Math.max(0, total401 - rules.limits.employee401k)) + employerMatch >
      rules.limits.combined401k
  ) {
    employerMatch = Math.max(0, rules.limits.combined401k - Math.min(total401, rules.limits.employee401k));
    warnings.push(
      'Employer 401(k) contribution was capped at the combined plan limit. Other employer retirement contributions are tracked separately.',
    );
  }
  const totalComp = roundMoney(gross + employerMatch + employerOtherContribution);
  if (input.deductions.some((d) => !Number.isFinite(d.annualAmount) || d.annualAmount < 0))
    throw new Error('Payroll deductions must be finite and nonnegative.');
  const deductions = input.deductions.map((d) => ({ ...d, annualAmount: roundMoney(d.annualAmount) }));
  const fsaRequested = deductions.filter((d) => d.kind === 'fsa').reduce((sum, d) => sum + d.annualAmount, 0);
  if (rules && fsaRequested > rules.limits.healthFsa) {
    const fsas = deductions.filter((d) => d.kind === 'fsa');
    let allocatedFsa = 0;
    for (const [index, d] of fsas.entries()) {
      d.annualAmount =
        index === fsas.length - 1
          ? roundMoney(rules.limits.healthFsa - allocatedFsa)
          : roundMoney((d.annualAmount * rules.limits.healthFsa) / fsaRequested);
      allocatedFsa += d.annualAmount;
    }
    warnings.push(
      'Health FSA contributions were capped at the published annual limit. Dependent-care FSA rules require a separate plan.',
    );
  }
  let hsa = roundMoney(nonnegative(input.hsaAnnual));
  if (input.hsaCoverage === 'none' && hsa > 0) {
    hsa = 0;
    warnings.push('No HSA-eligible coverage selected; no HSA contribution or tax benefit was assumed.');
  }
  if (hsa > 0 && fsaRequested > 0 && !input.hsaCompatibleFsa) {
    hsa = 0;
    warnings.push('Confirm a limited-purpose/post-deductible HSA-compatible FSA before using an HSA tax benefit.');
  }
  if (rules && hsa > 0) {
    const limit =
      (input.hsaCoverage === 'family' ? rules.limits.hsaFamily : rules.limits.hsaSelf) +
      (input.age >= 55 ? rules.limits.hsaCatchup : 0);
    if (hsa > limit) {
      hsa = limit;
      warnings.push(
        'HSA contributions were capped at the published coverage/age limit. Employer HSA contributions must be included in that shared limit.',
      );
    }
  }
  const incomeDeductions = deductions.filter((d) => d.reducesIncomeTax).reduce((sum, d) => sum + d.annualAmount, 0);
  const ficaDeductions =
    deductions.filter((d) => d.reducesFica).reduce((sum, d) => sum + d.annualAmount, 0) +
    (input.hsaThroughPayroll ? hsa : 0);
  const allDeductions = deductions.reduce((sum, d) => sum + d.annualAmount, 0);
  const ficaWages = roundMoney(Math.max(0, wages - ficaDeductions));
  const spouseFica = Math.min(ficaWages, nonnegative(input.spouseWagesIncluded));
  const primaryFica = Math.max(0, ficaWages - spouseFica);
  const socialSecurity = rules
    ? roundMoney(
        (Math.min(primaryFica, rules.socialSecurityWageBase) + Math.min(spouseFica, rules.socialSecurityWageBase)) *
          rules.socialSecurityRate,
      )
    : 0;
  const additionalMedicare = rules
    ? roundMoney(
        Math.max(0, ficaWages - rules.additionalMedicareThreshold[input.filingStatus]) * rules.additionalMedicareRate,
      )
    : 0;
  const medicare = rules ? roundMoney(ficaWages * rules.medicareRate + additionalMedicare) : 0;
  if (input.spouseWagesIncluded && ficaDeductions > 0)
    warnings.push(
      'Combined household FICA uses the supplied spouse wage share. Use actual per-person payroll records when deductions differ between spouses.',
    );
  let traditionalIra = contribution(input.traditionalIra, gross),
    rothIra = contribution(input.rothIra, gross);
  const iraLimit = rules
    ? Math.min(wages, rules.limits.ira + (input.age >= 50 ? rules.limits.catchupIra : 0))
    : traditionalIra + rothIra;
  if (traditionalIra + rothIra > iraLimit) {
    const factor = iraLimit / (traditionalIra + rothIra);
    traditionalIra = roundMoney(traditionalIra * factor);
    rothIra = roundMoney(iraLimit - traditionalIra);
    warnings.push(
      'Traditional and Roth IRA contributions share one annual compensation/age limit; the calculation caps the requested total proportionally.',
    );
  }
  const magi =
    input.iraModifiedAgiOverride ??
    Math.max(0, gross - traditional401k - incomeDeductions - hsa - nonnegative(input.federalAdjustments));
  let deductibleTraditionalIra = traditionalIra,
    permittedRothIra: number | null = null;
  if (rules) {
    const separateWithSpouse = input.filingStatus === 'married_separate' && input.livedWithSpouse !== false;
    if (
      input.coveredByWorkplacePlan ||
      (isJoint(input.filingStatus) && input.spouseCoveredByWorkplacePlan) ||
      (separateWithSpouse && input.spouseCoveredByWorkplacePlan)
    ) {
      const range: [number, number] = separateWithSpouse
        ? [0, 10000]
        : input.coveredByWorkplacePlan
          ? isJoint(input.filingStatus)
            ? rules.iraPhaseouts.traditionalJoint
            : rules.iraPhaseouts.traditionalSingle
          : rules.iraPhaseouts.traditionalSpouse;
      deductibleTraditionalIra = Math.min(traditionalIra, phaseoutLimit(iraLimit, magi, range));
    }
    const rothRange: [number, number] = separateWithSpouse
      ? [0, 10000]
      : isJoint(input.filingStatus)
        ? rules.iraPhaseouts.rothJoint
        : rules.iraPhaseouts.rothSingle;
    permittedRothIra = Math.max(0, Math.min(iraLimit - traditionalIra, phaseoutLimit(iraLimit, magi, rothRange)));
    if (rothIra > permittedRothIra) {
      rothIra = permittedRothIra;
      warnings.push(
        'The planned Roth IRA contribution was reduced by the supplied income/filing-status eligibility phaseout.',
      );
    }
    if (deductibleTraditionalIra < traditionalIra)
      warnings.push(
        'Some Traditional IRA contributions are nondeductible under the workplace-plan/MAGI phaseout; the full contribution still uses cash.',
      );
  }
  const agi = Math.max(
    0,
    gross - traditional401k - incomeDeductions - hsa - deductibleTraditionalIra - nonnegative(input.federalAdjustments),
  );
  let federalTax: number | null = null,
    federalTaxableIncome: number | null = null,
    federalMarginal: number | null = null;
  let stateTax: number | null = null,
    stateTaxableIncome: number | null = null,
    stateMarginal: number | null = null,
    localTax: number | null = null;
  if (rules) {
    const olderCount =
      (input.age >= 65 ? 1 : 0) + (isJoint(input.filingStatus) && (input.spouseAge ?? 0) >= 65 ? 1 : 0);
    const blindCount = (input.blind ? 1 : 0) + (isJoint(input.filingStatus) && input.spouseBlind ? 1 : 0);
    const extraStandard =
      (olderCount + blindCount) *
      (input.filingStatus === 'single' || input.filingStatus === 'head_household'
        ? rules.additionalStandardDeduction.unmarried
        : rules.additionalStandardDeduction.married);
    const federalDeduction =
      input.deductionMethod === 'itemized'
        ? nonnegative(input.federalItemizedDeduction)
        : rules.federalStandardDeduction[input.filingStatus] + extraStandard;
    const senior = rules.seniorDeduction;
    const seniorDeduction =
      input.filingStatus === 'married_separate' || input.taxYear < senior.firstYear || input.taxYear > senior.lastYear
        ? 0
        : olderCount *
          Math.max(
            0,
            senior.amount -
              Math.max(0, magi - (isJoint(input.filingStatus) ? senior.jointThreshold : senior.singleThreshold)) *
                senior.phaseoutRate,
          );
    federalTaxableIncome = roundMoney(Math.max(0, agi - federalDeduction - seniorDeduction));
    const federal = progressiveTax(federalTaxableIncome, rules.federalBrackets[input.filingStatus]);
    federalMarginal = federal.marginalRate;
    const eligibleChildren = Math.floor(nonnegative(input.childTaxCreditEligibleChildren));
    const otherEligible = Math.floor(nonnegative(input.otherDependentCreditEligibleCount));
    const familyCredit = Math.max(
      0,
      eligibleChildren * rules.dependentCredits.child +
        otherEligible * rules.dependentCredits.other -
        Math.ceil(
          Math.max(
            0,
            magi -
              (isJoint(input.filingStatus)
                ? rules.dependentCredits.phaseoutJoint
                : rules.dependentCredits.phaseoutSingle),
          ) / 1000,
        ) *
          50,
    );
    federalTax = roundMoney(Math.max(0, federal.tax - familyCredit - nonnegative(input.federalCredits)));
    if (input.dependents > 0 && eligibleChildren + otherEligible === 0)
      warnings.push(
        'Dependent count does not establish federal credit eligibility. Enter eligible child/dependent counts or verified credit amounts separately.',
      );
    const state = rules.states[input.residenceState];
    let stateUnavailable = false;
    if (!state) {
      warnings.push('State rules unavailable.');
      stateUnavailable = true;
    } else {
      if (input.stateTaxableIncomeOverride !== undefined) {
        stateTaxableIncome = roundMoney(nonnegative(input.stateTaxableIncomeOverride));
        warnings.push('State taxable income uses the supplied verified override rather than an inferred deduction.');
      } else if (state.requiresTaxableOverride) {
        warnings.push(
          'Maryland state deduction/exemption computation requires a verified taxable-income override; published state and county rate schedules are retained.',
        );
        stateUnavailable = true;
      } else {
        let stateDeduction =
          input.deductionMethod === 'itemized'
            ? input.stateItemizedDeduction
            : state.standardDeduction[input.filingStatus];
        if (stateDeduction === undefined) {
          warnings.push(
            'State itemized deduction must be entered separately; federal itemized deductions were not reused.',
          );
          stateUnavailable = true;
          stateDeduction = 0;
        }
        const exemptions =
          (1 + (isJoint(input.filingStatus) ? 1 : 0) + input.dependents) * (state.personalExemption ?? 0);
        const dcExtra = input.residenceState === 'DC' && input.deductionMethod === 'standard' ? extraStandard : 0;
        stateTaxableIncome = roundMoney(
          Math.max(0, agi + nonnegative(input.stateAdjustments) - stateDeduction - exemptions - dcExtra),
        );
        const hasSenior = input.age >= 65 || (isJoint(input.filingStatus) && (input.spouseAge ?? 0) >= 65);
        if (input.residenceState === 'VA' && hasSenior) {
          warnings.push('Virginia age deduction requires verified state taxable income for this age profile.');
          stateUnavailable = true;
          stateTaxableIncome = null;
        }
        if (input.residenceState === 'WV' && hasSenior) {
          warnings.push(
            'West Virginia senior income modification requires verified state taxable income for this age profile.',
          );
          stateUnavailable = true;
          stateTaxableIncome = null;
        }
        if (input.residenceState === 'WV' && agi < 30000 && gross > 0) {
          warnings.push(
            'West Virginia low-income exclusion/family-credit eligibility requires verified state taxable income/credits.',
          );
          stateUnavailable = true;
        }
        if (input.residenceState === 'NC' && input.dependents > 0) {
          warnings.push(
            'North Carolina child deduction requires verified state taxable income for this dependent profile.',
          );
          stateUnavailable = true;
        }
        if (input.residenceState === 'DC' && input.deductionMethod === 'itemized' && agi > 200000) {
          warnings.push(
            'DC itemized-deduction limitation requires verified state taxable income at this income level.',
          );
          stateUnavailable = true;
        }
      }
      if (input.employmentState && !canUseResidenceOnly(input.residenceState, input.employmentState)) {
        warnings.push(
          'This nonreciprocal interstate employment scenario needs source-state income and credit-for-other-state calculations; state/local totals are unavailable.',
        );
        stateUnavailable = true;
      }
      if (!stateUnavailable && stateTaxableIncome !== null) {
        const stateComputed = progressiveTax(stateTaxableIncome, state.brackets[input.filingStatus]);
        stateTax = roundMoney(Math.max(0, stateComputed.tax - nonnegative(input.stateCredits)));
        stateMarginal = stateComputed.marginalRate;
        localTax =
          input.localAnnualTaxOverride !== undefined
            ? nonnegative(input.localAnnualTaxOverride)
            : input.residenceState === 'MD'
              ? rules.taxYear === 2026 || rules.status === 'estimated'
                ? localTaxMd(stateTaxableIncome, input.locality, input.filingStatus)
                : null
              : 0;
        if (localTax === null)
          warnings.push('Select a verified Maryland county/city or supply a verified annual local-tax override.');
      }
    }
  }
  const complete = federalTax !== null && stateTax !== null && localTax !== null;
  const taxes = complete ? roundMoney(federalTax! + stateTax! + localTax! + socialSecurity + medicare) : null;
  const net = taxes === null ? null : roundMoney(gross - taxes);
  const takeHome =
    net === null ? null : roundMoney(net - total401 - allDeductions - (input.hsaThroughPayroll ? hsa : 0));
  const afterIra =
    takeHome === null ? null : roundMoney(takeHome - traditionalIra - rothIra - (!input.hsaThroughPayroll ? hsa : 0));
  const allocationsBases = { gross, net: net ?? 0, takeHome: takeHome ?? 0 };
  const investments = complete ? resolveAmount(input.investments, allocationsBases) : null;
  const savings = complete ? resolveAmount(input.savings, allocationsBases) : null;
  const spendable = afterIra === null ? null : roundMoney(afterIra - (investments ?? 0) - (savings ?? 0));
  const retirement = roundMoney(total401 + traditionalIra + rothIra + employerMatch + employerOtherContribution);
  if (spendable !== null && spendable < 0)
    warnings.push('Allocations exceed available cash. No reconciled Sankey is drawn until inputs are reduced.');
  const annual = {
    gross,
    salary,
    bonus,
    employerMatch,
    employerOtherContribution,
    totalComp,
    federalTax,
    stateTax,
    localTax,
    socialSecurity: rules ? socialSecurity : null,
    medicare: rules ? medicare : null,
    additionalMedicare: rules ? additionalMedicare : null,
    taxes,
    federalTaxableIncome,
    stateTaxableIncome,
    ficaWages,
    net,
    takeHome,
    afterIra,
    spendable,
    traditional401k,
    roth401k,
    traditionalIra,
    rothIra,
    deductibleTraditionalIra,
    permittedRothIra,
    hsa,
    otherPreTaxDeductions: roundMoney(incomeDeductions),
    otherPostTaxDeductions: roundMoney(allDeductions - incomeDeductions),
    investments,
    savings,
    retirement,
  };
  const breakdown: IncomeBreakdownRow[] = [];
  const add = (id: string, group: string, label: string, value: number | null, subtotal = false, note?: string) => {
    if (value !== null) breakdown.push({ id, group, label, ...periods(value), subtotal, note });
  };
  add('gross', 'Income', 'Gross', gross);
  add('federal', 'Taxes', 'Federal', federalTax);
  add('state', 'Taxes', 'State', stateTax);
  add('local', 'Taxes', 'Local', localTax);
  add('socialSecurity', 'Taxes', 'Social Security', rules ? socialSecurity : null);
  add('medicare', 'Taxes', 'Medicare', rules ? medicare : null);
  add('net', 'Taxes', 'Net', net, true);
  add(
    'traditionalIra',
    'Before/Pre Tax Deductions',
    'Trad IRA',
    traditionalIra,
    false,
    'An IRA is not a payroll deduction. Only the eligible deductible portion reduces taxable income; the cash contribution is allocated after take-home pay.',
  );
  add('traditional401k', 'Before/Pre Tax Deductions', 'Trad 401k', traditional401k);
  add(
    'preTax',
    'Before/Pre Tax Deductions',
    'Other Pre-Tax Deductions',
    incomeDeductions + (input.hsaThroughPayroll ? hsa : 0),
  );
  add(
    'rothIra',
    'After/Post Tax Deductions',
    'Roth IRA',
    rothIra,
    false,
    'Outside-payroll cash allocation, not subtracted from paycheck take-home.',
  );
  add('roth401k', 'After/Post Tax Deductions', 'Roth 401k', roth401k);
  add('postTax', 'After/Post Tax Deductions', 'Other Post-Tax Deductions', allDeductions - incomeDeductions);
  add('match', 'Employer Contributions', 'Match', employerMatch);
  if (employerOtherContribution)
    add(
      'employerOther',
      'Employer Contributions',
      input.employerOtherContributionName || 'Other employer retirement contribution',
      employerOtherContribution,
    );
  add(
    'takeHome',
    'Employer Contributions',
    'Take Home',
    takeHome,
    true,
    'Payroll net. IRA and outside-payroll HSA allocations are deducted separately when calculating Spendable.',
  );
  add('investments', 'Savings on Take Home', 'Investments', investments);
  add('savings', 'Savings on Take Home', 'Savings', savings);
  add('spendable', 'Savings on Take Home', 'Spendable', spendable, true);
  const allocations: AllocationRow[] = [];
  const allocation = (id: string, label: string, value: number) =>
    allocations.push({ id, label, percent: pct(value, totalComp), ...periods(value) });
  if (complete) {
    allocation('spending', 'Spending Money', spendable!);
    allocation('savingsInvestments', 'Savings and Investments', savings! + investments! + hsa);
    allocation('retirement', 'Retirement', retirement);
    allocation('taxes', 'Taxes', taxes!);
    if (allDeductions > 0) allocation('otherDeductions', 'Other Payroll Deductions', allDeductions);
  }
  const node = (id: string, name: string, amount: number, children?: IncomeFlowNode[]): IncomeFlowNode => {
    const shown = children?.filter((c) => c.amount > 0);
    if (shown?.length) {
      const difference = roundMoney(roundMoney(amount) - shown.reduce((sum, c) => sum + c.amount, 0));
      if (Math.abs(difference) <= 0.05)
        shown[shown.length - 1]!.amount = roundMoney(shown[shown.length - 1]!.amount + difference);
    }
    return {
      id,
      name,
      amount: roundMoney(amount),
      percentOfTotal: pct(amount, totalComp),
      percentOfParent: 0,
      ...(shown ? { children: shown } : {}),
    };
  };
  let flow: IncomeFlowNode | null = null;
  if (complete && spendable !== null && spendable >= 0 && totalComp > 0) {
    const goals = input.savingsGoals ?? [];
    const goalTotal = goals.reduce((sum, g) => sum + nonnegative(g.percentOfSavings), 0);
    const savingChildren = goals.map((g) =>
      node('goal-' + g.id, g.name, (savings! * nonnegative(g.percentOfSavings)) / 100),
    );
    if (goalTotal < 100)
      savingChildren.push(node('otherSavings', 'Other savings accounts/goals', (savings! * (100 - goalTotal)) / 100));
    if (goalTotal > 100) warnings.push('Savings goals exceed 100%; only the unsplit savings total is drawn.');
    flow = node('totalComp', 'Total Compensation', totalComp, [
      node('taxes', 'Taxes', taxes!, [
        node('incomeTaxes', 'Income Taxes', federalTax! + stateTax! + localTax!, [
          node('federal', 'Federal', federalTax!),
          node('state', 'State', stateTax!),
          node('local', 'Local', localTax!),
        ]),
        node('fica', 'FICA', socialSecurity + medicare, [
          node('socialSecurity', 'Social Security', socialSecurity),
          node('medicare', 'Medicare', medicare),
        ]),
      ]),
      node(
        'savingsInvestmentsRetirement',
        'Savings, Investments & Retirement',
        retirement + investments! + savings! + hsa,
        [
          node('retirement', 'Retirement', retirement, [
            node('401k', '401(k)', total401 + employerMatch, [
              node('traditional401k', 'Traditional 401(k)', traditional401k),
              node('roth401k', 'Roth 401(k)', roth401k),
              node('employerMatch', 'Employer Match', employerMatch),
            ]),
            node('ira', 'IRA', traditionalIra + rothIra, [
              node('traditionalIra', 'Traditional IRA', traditionalIra),
              node('rothIra', 'Roth IRA', rothIra),
            ]),
            node(
              'employerOther',
              input.employerOtherContributionName || 'Other employer retirement contribution',
              employerOtherContribution,
            ),
          ]),
          node('investments', 'Investments', investments!, [
            node('individualInvestments', 'Individual investment accounts', investments!),
          ]),
          node('savings', 'Savings', savings!, goalTotal <= 100 ? savingChildren : undefined),
          node('hsa', 'HSA', hsa),
        ],
      ),
      node(
        'deductions',
        'Other Payroll Deductions',
        allDeductions,
        deductions.map((d) => node('deduction-' + d.id, d.name, d.annualAmount)),
      ),
      node('spending', 'Spending Money / Disposable Income', spendable),
    ]);
    function assign(node: IncomeFlowNode, parent: number): void {
      node.percentOfParent = pct(node.amount, parent);
      node.percentOfTotal = pct(node.amount, totalComp);
      for (const child of node.children ?? []) assign(child, node.amount);
    }
    assign(flow, totalComp);
    const allocated = (flow.children ?? []).reduce((sum, n) => sum + n.amount, 0);
    if (Math.abs(allocated - totalComp) > 0.03) {
      flow = null;
      warnings.push('Allocation totals do not reconcile; the Sankey was withheld.');
    }
  }
  const actualParts = [input.actualFederalWithholding, input.actualStateWithholding, input.actualLocalWithholding];
  const actualIncomeTax = actualParts.every((v) => v !== undefined)
    ? roundMoney(actualParts.reduce<number>((sum, v) => sum + nonnegative(v), 0))
    : null;
  const estimatedIncomeTax = complete ? roundMoney(federalTax! + stateTax! + localTax!) : null;
  const gap =
    actualIncomeTax !== null && estimatedIncomeTax !== null ? roundMoney(actualIncomeTax - estimatedIncomeTax) : null;
  const perYear = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, annual: 1 }[input.payFrequency];
  return {
    available: complete,
    taxYear: input.taxYear,
    ruleStatus: rules?.status ?? 'unavailable',
    warnings,
    sources: rules ? [...rules.sources, ...(rules.states[input.residenceState]?.sources ?? [])] : [],
    annual,
    rates: {
      federalMarginal,
      stateMarginal,
      federalEffective: federalTax === null ? null : pct(federalTax, gross),
      totalEffective: taxes === null ? null : pct(taxes, gross),
    },
    withholding: {
      actualIncomeTax,
      estimatedIncomeTax,
      projectedRefund: gap === null ? null : Math.max(0, gap),
      projectedOwed: gap === null ? null : Math.max(0, -gap),
    },
    limits: rules?.limits ?? null,
    breakdown,
    allocations,
    flow,
    savingsInvestmentsRetirementPercent: complete ? pct(retirement + savings! + investments! + hsa, totalComp) : null,
    allocationPercentages: complete
      ? {
          investments: {
            gross: pct(investments!, gross),
            net: pct(investments!, net!),
            takeHome: pct(investments!, takeHome!),
          },
          savings: { gross: pct(savings!, gross), net: pct(savings!, net!), takeHome: pct(savings!, takeHome!) },
        }
      : null,
    averages: {
      periodsPerYear: perYear,
      takeHomePerPaycheck: takeHome === null ? null : roundMoney(takeHome / perYear),
      note: 'Average annualized amounts, not actual dated paychecks. Actual pay varies with bonuses, withholding, limits and payroll dates.',
    },
  };
}
