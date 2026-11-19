import { roundMoney } from './calculate';

export interface WealthProjectionInput {
  years: number;
  startingBalance: number;
  annualContribution: number;
  contributionFrequency: 'biweekly' | 'monthly' | 'annual';
  annualReturnPercent: number;
  salaryGrowthPercent: number;
  inflationPercent: number;
}
export interface WealthProjectionPoint {
  year: number;
  /** Starting market balance plus new contributions, not historical tax cost basis. */
  contributions: number;
  newContributions: number;
  startingBalance: number;
  value: number;
  returns: number;
  realValue: number;
}
export interface WealthProjectionResult {
  scenarios: Array<{ frequency: 'biweekly' | 'monthly' | 'annual'; points: WealthProjectionPoint[] }>;
  warnings: string[];
  assumptions: WealthProjectionInput & { contributionTiming: 'end-of-period'; returnConvention: 'effective-annual' };
}

/** Pure scenarios. Never modifies historical balances or claims forecast returns are actual. */
export function projectWealth(input: WealthProjectionInput): WealthProjectionResult {
  if (!Number.isInteger(input.years) || input.years < 1 || input.years > 80)
    throw new Error('Projection duration must be 1–80 whole years.');
  if (
    ![
      input.startingBalance,
      input.annualContribution,
      input.annualReturnPercent,
      input.salaryGrowthPercent,
      input.inflationPercent,
    ].every(Number.isFinite)
  )
    throw new Error('Projection assumptions must be finite.');
  if (
    input.startingBalance < 0 ||
    input.annualContribution < 0 ||
    input.annualReturnPercent <= -100 ||
    input.inflationPercent <= -100 ||
    input.salaryGrowthPercent < -100
  )
    throw new Error('Projection amounts/rates are outside supported bounds.');
  const frequencies = ['biweekly', 'monthly', 'annual'] as const;
  const scenarios = frequencies.map((frequency) => {
    const periods = { biweekly: 26, monthly: 12, annual: 1 }[frequency];
    const rate = (1 + input.annualReturnPercent / 100) ** (1 / periods) - 1;
    let value = input.startingBalance,
      contributed = 0;
    const points: WealthProjectionPoint[] = [
      {
        year: 0,
        contributions: roundMoney(value),
        newContributions: 0,
        startingBalance: roundMoney(value),
        value: roundMoney(value),
        returns: 0,
        realValue: roundMoney(value),
      },
    ];
    for (let year = 1; year <= input.years; year++) {
      const annualContribution = input.annualContribution * (1 + input.salaryGrowthPercent / 100) ** (year - 1);
      for (let period = 0; period < periods; period++) {
        value = value * (1 + rate) + annualContribution / periods;
      }
      contributed += annualContribution;
      if (!Number.isFinite(value)) throw new Error('Projection exceeds finite numeric range.');
      points.push({
        year,
        contributions: roundMoney(input.startingBalance + contributed),
        newContributions: roundMoney(contributed),
        startingBalance: roundMoney(input.startingBalance),
        value: roundMoney(value),
        returns: roundMoney(value - input.startingBalance - contributed),
        realValue: roundMoney(value / (1 + input.inflationPercent / 100) ** year),
      });
    }
    return { frequency, points };
  });
  return {
    scenarios,
    warnings: [
      'Projected returns and inflation are assumptions, not guaranteed performance. Contributions are end-of-period; displayed periods are annualized averages. Starting balance is market value, not verified historical cost basis.',
    ],
    assumptions: { ...input, contributionTiming: 'end-of-period', returnConvention: 'effective-annual' },
  };
}
