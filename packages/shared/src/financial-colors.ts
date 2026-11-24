import registry from './financial-colors.json';
/** Canonical user-selected financial palette. Transaction category and UI brand palettes are separate. */
export const FINANCIAL_COLORS = Object.freeze(registry.colors);
export const NET_WORTH_COLORS = Object.freeze(registry.netWorth);
export type FinancialRole = keyof typeof FINANCIAL_COLORS;
export function financialColor(role: FinancialRole): string {
  return FINANCIAL_COLORS[role];
}
export function investmentTypeColor(type?: string): string {
  const key = (type ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (/crypto|coin/.test(key)) return FINANCIAL_COLORS.crypto;
  if (/etf|exchangetraded/.test(key)) return FINANCIAL_COLORS.etfs;
  if (/mutual|fund/.test(key)) return FINANCIAL_COLORS.mutualFunds;
  if (/cash|money/.test(key)) return FINANCIAL_COLORS.cash;
  if (/stock|equity/.test(key)) return FINANCIAL_COLORS.stocks;
  return FINANCIAL_COLORS.investments;
}
export function accountFinancialColor(category?: string): string {
  const key = (category ?? '').toLowerCase();
  if (/retire|401|ira|pension/.test(key)) return FINANCIAL_COLORS.retirement;
  if (/emergency/.test(key)) return FINANCIAL_COLORS.emergencyFund;
  if (/savings|saving/.test(key)) return FINANCIAL_COLORS.savings;
  if (/invest|broker|crypto/.test(key)) return FINANCIAL_COLORS.investments;
  if (/liabil|credit|loan|debt/.test(key)) return FINANCIAL_COLORS.liabilities;
  return FINANCIAL_COLORS.cash;
}
/** Stable identity-based shades; sorting/filtering never changes a series color. */
export function investmentSeriesColor(id: string, retirement = false): string {
  const shades = retirement
    ? [
        FINANCIAL_COLORS.traditional401k,
        FINANCIAL_COLORS.roth401k,
        FINANCIAL_COLORS.employerRetirement,
        FINANCIAL_COLORS.ira,
      ]
    : [FINANCIAL_COLORS.stocks, FINANCIAL_COLORS.etfs, FINANCIAL_COLORS.mutualFunds, FINANCIAL_COLORS.crypto];
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return shades[hash % shades.length]!;
}

export function payrollDetailColor(id: string, label = ''): string {
  const roles: Record<string, FinancialRole> = {
    'other-income': 'income',
    salary: 'salary',
    gross: 'salary',
    bonus: 'bonus',
    net: 'spendable',
    takeHome: 'spendable',
    spendable: 'spendable',
    spending: 'spendable',
    totalComp: 'income',
    federal: 'federalTax',
    federalTax: 'federalTax',
    state: 'stateTax',
    stateTax: 'stateTax',
    local: 'localTax',
    localTax: 'localTax',
    socialSecurity: 'socialSecurity',
    medicare: 'medicare',
    taxes: 'taxes',
    traditional401k: 'traditional401k',
    roth401k: 'roth401k',
    '401k': 'retirement',
    retirement: 'retirement',
    ira: 'ira',
    traditionalIra: 'ira',
    rothIra: 'ira',
    employerMatch: 'employerRetirement',
    employerOther: 'employerRetirement',
    employerRetirement: 'employerRetirement',
    match: 'employerRetirement',
    'employer-match': 'employerRetirement',
    'employer-other': 'employerRetirement',
    employer: 'employerRetirement',
    savings: 'savings',
    investments: 'investments',
    individualInvestments: 'investments',
    hsa: 'savings',
    payrollHsa: 'savings',
    outsideHsa: 'savings',
  };
  if (roles[id]) return FINANCIAL_COLORS[roles[id]!];
  if (/dental/i.test(label)) return FINANCIAL_COLORS.dentalInsurance;
  if (/vision/i.test(label)) return FINANCIAL_COLORS.visionInsurance;
  if (/health|medical/i.test(label)) return FINANCIAL_COLORS.healthInsurance;
  return FINANCIAL_COLORS.deductions;
}
