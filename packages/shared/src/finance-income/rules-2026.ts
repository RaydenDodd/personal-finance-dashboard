import type { Bracket, FilingStatus, TaxRuleSet, TaxSource } from './types';

const checkedAt = '2026-11-19';
const source = (title: string, url: string): TaxSource => ({ title, url, checkedAt });
const bracket = (thresholds: Array<number | null>, rates: number[]): Bracket[] =>
  thresholds.map((upTo, index) => ({ upTo, rate: rates[index]! }));
const all = (value: Bracket[]): Record<FilingStatus, Bracket[]> => ({
  single: value,
  married_joint: value,
  married_separate: value,
  head_household: value,
});
const deductions = (single: number, joint = single, head = single): Record<FilingStatus, number> => ({
  single,
  married_joint: joint,
  married_separate: single,
  head_household: head,
});
const federal = source(
  'IRS Revenue Procedure 2025-32: published 2026 brackets, standard deductions and FSA limit',
  'https://www.irs.gov/irb/2025-45_IRB',
);
const retirement = source(
  'IRS Notice 2025-67: 2026 retirement limits and phaseouts',
  'https://www.irs.gov/pub/irs-drop/n-25-67.pdf',
);
const hsa = source('IRS Revenue Procedure 2025-19: 2026 HSA limits', 'https://www.irs.gov/pub/irs-drop/rp-25-19.pdf');
const ssa = source('SSA 2026 contribution and benefit base', 'https://www.ssa.gov/OACT/COLA/cbb.html');
const va = source(
  'Virginia published 2026 standard deduction',
  'https://www.tax.virginia.gov/news/new-virginia-tax-laws',
);
const vaRates = source(
  'Virginia income-tax rates and exemptions, Code 58.1',
  'https://law.lis.virginia.gov/vacodefull/title58.1/',
);
const dc = source('DC published tax rates', 'https://otr.cfo.dc.gov/page/dc-individual-and-fiduciary-income-tax-rates');
const dcDeduction = source(
  'DC 2026 D-40ES worksheet: 2026 standard deduction',
  'https://otr.cfo.dc.gov/sites/default/files/dc/sites/otr/publication/attachments/2026_D40ES_Book_wLinks04012026.pdf',
);
const md = source(
  'Maryland 2026 published state/local tax rate schedules',
  'https://www.marylandcomptroller.gov/content/dam/mdcomp/tax/legal-publications/facts/withholding-tax-facts-2026.pdf',
);
const mdLocal = source(
  'Maryland 2026 county rates and tiered local schedules',
  'https://services.marylandcomptroller.gov/taxes/en/maryland-income-tax-rates-and-brackets?id=kb_article_view&sysparm_article=KB0010014',
);
const wv = source(
  'WV 2026 rate cut, enacted March 31 and retroactive to January 1',
  'https://tax.wv.gov/Individuals/Pages/PersonalIncomeTaxReductionBill.aspx',
);
const wvExemption = source('WV Code 11-21-16 personal exemptions', 'https://code.wvlegislature.gov/11-21-16/');
const nc = source(
  'NC 2026 tax rate and standard deduction, NC-40',
  'https://www.ncdor.gov/individual-estimated-income-tax/open',
);

const mdSingle = bracket(
  [1000, 2000, 3000, 100000, 125000, 150000, 250000, 500000, 1000000, null],
  [0.02, 0.03, 0.04, 0.0475, 0.05, 0.0525, 0.055, 0.0575, 0.0625, 0.065],
);
const mdJoint = bracket(
  [1000, 2000, 3000, 150000, 175000, 225000, 300000, 600000, 1200000, null],
  [0.02, 0.03, 0.04, 0.0475, 0.05, 0.0525, 0.055, 0.0575, 0.0625, 0.065],
);
const wvGeneral = bracket([10000, 25000, 40000, 60000, null], [0.0211, 0.0281, 0.0316, 0.0422, 0.0458]);

/** Immutable year-keyed baseline. Never reused as published rules for another year. */
export const TAX_RULES_2026: TaxRuleSet = {
  taxYear: 2026,
  status: 'published',
  checkedAt,
  federalBrackets: {
    single: bracket([12400, 50400, 105700, 201775, 256225, 640600, null], [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37]),
    married_joint: bracket(
      [24800, 100800, 211400, 403550, 512450, 768700, null],
      [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37],
    ),
    married_separate: bracket(
      [12400, 50400, 105700, 201775, 256225, 384350, null],
      [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37],
    ),
    head_household: bracket(
      [17700, 67450, 105700, 201750, 256200, 640600, null],
      [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37],
    ),
  },
  federalStandardDeduction: deductions(16100, 32200, 24150),
  additionalStandardDeduction: { unmarried: 2050, married: 1650 },
  seniorDeduction: {
    firstYear: 2025,
    lastYear: 2028,
    amount: 6000,
    phaseoutRate: 0.06,
    singleThreshold: 75000,
    jointThreshold: 150000,
  },
  dependentCredits: { child: 2200, other: 500, phaseoutSingle: 200000, phaseoutJoint: 400000 },
  rothCatchupPriorYearWageThreshold: 150000,
  socialSecurityWageBase: 184500,
  socialSecurityRate: 0.062,
  medicareRate: 0.0145,
  additionalMedicareRate: 0.009,
  additionalMedicareThreshold: {
    single: 200000,
    married_joint: 250000,
    married_separate: 125000,
    head_household: 200000,
  },
  limits: {
    employee401k: 24500,
    catchup401k: 8000,
    catchup401k60to63: 11250,
    combined401k: 72000,
    ira: 7500,
    catchupIra: 1100,
    hsaSelf: 4400,
    hsaFamily: 8750,
    hsaCatchup: 1000,
    healthFsa: 3400,
  },
  iraPhaseouts: {
    traditionalSingle: [81000, 91000],
    traditionalJoint: [129000, 149000],
    traditionalSpouse: [242000, 252000],
    rothSingle: [153000, 168000],
    rothJoint: [242000, 252000],
  },
  states: {
    VA: {
      brackets: all(bracket([3000, 5000, 17000, null], [0.02, 0.03, 0.05, 0.0575])),
      standardDeduction: deductions(8750, 17500, 8750),
      personalExemption: 930,
      sources: [va, vaRates],
    },
    DC: {
      brackets: all(
        bracket(
          [10000, 40000, 60000, 250000, 500000, 1000000, null],
          [0.04, 0.06, 0.065, 0.085, 0.0925, 0.0975, 0.1075],
        ),
      ),
      standardDeduction: deductions(16100, 32200, 24150),
      sources: [dc, dcDeduction],
    },
    // Published rate schedules are supported; a verified taxable-income amount is required
    // until the complete year-specific return deduction/exemption calculation is certified.
    MD: {
      brackets: { single: mdSingle, married_joint: mdJoint, married_separate: mdSingle, head_household: mdJoint },
      standardDeduction: deductions(0),
      requiresTaxableOverride: true,
      sources: [md, mdLocal],
    },
    WV: {
      brackets: {
        ...all(wvGeneral),
        married_separate: bracket([5000, 12500, 20000, 30000, null], [0.0211, 0.0281, 0.0316, 0.0422, 0.0458]),
      },
      standardDeduction: deductions(0),
      personalExemption: 2000,
      sources: [wv, wvExemption],
    },
    NC: { brackets: all(bracket([null], [0.0399])), standardDeduction: deductions(12750, 25500, 19125), sources: [nc] },
  },
  sources: [
    federal,
    retirement,
    hsa,
    ssa,
    source('IRS Additional Medicare Tax thresholds', 'https://www.irs.gov/taxtopics/tc560'),
    source('IRS Publication 590-A IRA eligibility and deductibility', 'https://www.irs.gov/publications/p590a'),
    source(
      'IRS temporary senior deduction and dependent credit provisions',
      'https://www.irs.gov/newsroom/working-families-tax-cuts',
    ),
  ],
};

export const MARYLAND_LOCAL_RATES_2026: Record<string, number> = {
  allegany: 0.032,
  baltimorecity: 0.032,
  baltimore: 0.032,
  calvert: 0.032,
  caroline: 0.032,
  carroll: 0.0303,
  cecil: 0.0274,
  charles: 0.0303,
  dorchester: 0.033,
  garrett: 0.0265,
  harford: 0.0306,
  howard: 0.032,
  kent: 0.033,
  montgomery: 0.032,
  princegeorges: 0.032,
  queenannes: 0.032,
  saintmarys: 0.032,
  somerset: 0.032,
  talbot: 0.024,
  washington: 0.0295,
  wicomico: 0.032,
  worcester: 0.0225,
};
