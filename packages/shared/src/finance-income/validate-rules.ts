import type { Bracket, TaxRuleSet } from './types';

/** Validate a proposed year-specific cache entry before storing or using it. */
export function validateTaxRuleSet(rules: TaxRuleSet): string[] {
  const errors: string[] = [];
  const nonnegative = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const rate = (value: unknown) => nonnegative(value) && (value as number) <= 1;
  if (!rules || !Number.isInteger(rules.taxYear) || rules.taxYear < 1900 || rules.taxYear > 2200)
    return ['Invalid tax-rule year.'];
  if (!['published', 'estimated'].includes(rules.status))
    errors.push('Rule status must distinguish published and estimated.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rules.checkedAt)) errors.push('Rule validation date is required.');
  const checkBrackets = (brackets: Bracket[] | undefined, label: string) => {
    if (!brackets?.length) {
      errors.push(`${label}: brackets unavailable.`);
      return;
    }
    let previous = 0;
    for (const [index, bracket] of brackets.entries()) {
      if (!Number.isFinite(bracket.rate) || bracket.rate < 0 || bracket.rate > 1)
        errors.push(`${label}: invalid tax rate.`);
      if (bracket.upTo === null) {
        if (index !== brackets.length - 1) errors.push(`${label}: open bracket must be last.`);
      } else if (!Number.isFinite(bracket.upTo) || bracket.upTo <= previous)
        errors.push(`${label}: thresholds must be increasing.`);
      else previous = bracket.upTo;
    }
    if (brackets.at(-1)?.upTo !== null) errors.push(`${label}: final open bracket required.`);
  };
  for (const filing of ['single', 'married_joint', 'married_separate', 'head_household'] as const) {
    checkBrackets(rules.federalBrackets?.[filing], `Federal ${filing}`);
    if (!Number.isFinite(rules.federalStandardDeduction?.[filing]) || rules.federalStandardDeduction[filing] < 0)
      errors.push(`Federal ${filing}: invalid standard deduction.`);
  }
  for (const state of ['VA', 'DC', 'MD', 'WV', 'NC'] as const) {
    if (!rules.states?.[state]) {
      errors.push(`${state}: missing state rule.`);
      continue;
    }
    for (const filing of ['single', 'married_joint', 'married_separate', 'head_household'] as const) {
      checkBrackets(rules.states[state].brackets?.[filing], `${state} ${filing}`);
      if (!nonnegative(rules.states[state].standardDeduction?.[filing]))
        errors.push(`${state} ${filing}: invalid standard deduction.`);
    }
    if (rules.states[state].personalExemption !== undefined && !nonnegative(rules.states[state].personalExemption))
      errors.push(`${state}: invalid personal exemption.`);
    if (!rules.states[state].sources?.length) errors.push(`${state}: missing official source reference.`);
  }
  for (const name of [
    'employee401k',
    'catchup401k',
    'catchup401k60to63',
    'combined401k',
    'ira',
    'catchupIra',
    'hsaSelf',
    'hsaFamily',
    'hsaCatchup',
    'healthFsa',
  ] as const)
    if (!nonnegative(rules.limits?.[name])) errors.push(`Invalid contribution limit: ${name}.`);
  for (const name of ['socialSecurityRate', 'medicareRate', 'additionalMedicareRate'] as const)
    if (!rate(rules[name])) errors.push(`Invalid tax rate: ${name}.`);
  for (const filing of ['single', 'married_joint', 'married_separate', 'head_household'] as const)
    if (!nonnegative(rules.additionalMedicareThreshold?.[filing]))
      errors.push(`Invalid Additional Medicare threshold: ${filing}.`);
  for (const name of [
    'traditionalSingle',
    'traditionalJoint',
    'traditionalSpouse',
    'rothSingle',
    'rothJoint',
  ] as const) {
    const range = rules.iraPhaseouts?.[name];
    if (!range || !nonnegative(range[0]) || !nonnegative(range[1]) || range[1] <= range[0])
      errors.push(`Invalid IRA phaseout: ${name}.`);
  }
  if (!Number.isFinite(rules.socialSecurityWageBase) || rules.socialSecurityWageBase <= 0)
    errors.push('Invalid Social Security wage base.');
  if (!rules.sources?.length) errors.push('Official federal source references are required.');
  if (
    !rules.additionalStandardDeduction ||
    !rules.seniorDeduction ||
    !rules.dependentCredits ||
    !Number.isFinite(rules.rothCatchupPriorYearWageThreshold)
  )
    errors.push('Year-specific deduction, credit and catch-up policy metadata is required.');
  else {
    if (Object.values(rules.additionalStandardDeduction).some((value) => !nonnegative(value)))
      errors.push('Invalid additional standard deduction.');
    if (
      Object.values(rules.seniorDeduction).some((value) => !nonnegative(value)) ||
      rules.seniorDeduction.lastYear < rules.seniorDeduction.firstYear ||
      !rate(rules.seniorDeduction.phaseoutRate)
    )
      errors.push('Invalid senior deduction policy.');
    if (Object.values(rules.dependentCredits).some((value) => !nonnegative(value)))
      errors.push('Invalid dependent credit policy.');
  }
  return errors;
}
