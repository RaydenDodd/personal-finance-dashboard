import { buildSync } from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const output = path.join(os.tmpdir(), `finance-income-test-${process.pid}.cjs`);
buildSync({
  entryPoints: [fileURLToPath(new URL('./index.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: output,
});
const require = createRequire(import.meta.url);
const {
  calculateIncomePlan: calc,
  createDefaultIncomePlan: defaults,
  progressiveTax,
  projectWealth,
  TAX_RULES_2026,
  validateTaxRuleSet,
} = require(output);
fs.unlinkSync(output);
const plan = (values) => ({ ...defaults(), annualSalary: 100000, ...values });

test('new planning defaults do not invent an age or age-related benefit', () => {
  assert.equal(defaults().age, 0);
  assert.ok(calc(plan({})).warnings.some((w) => w.includes('Age is not supplied')));
});

test('federal progressive brackets apply only to the marginal excess', () => {
  const brackets = TAX_RULES_2026.federalBrackets.single;
  assert.equal(progressiveTax(12400, brackets).tax, 1240);
  assert.equal(progressiveTax(12401, brackets).tax, 1240.12);
  assert.equal(progressiveTax(50400, brackets).tax, 5800);
  assert.equal(progressiveTax(50401, brackets).tax, 5800.22);
});
test('ordinary Virginia wage estimate uses published standard deductions and personal exemption', () => {
  const result = calc(plan({}));
  assert.equal(result.annual.federalTaxableIncome, 83900);
  assert.equal(result.annual.federalTax, 13170);
  assert.equal(result.annual.stateTaxableIncome, 90320);
  assert.equal(result.annual.stateTax, 4935.9);
  assert.equal(result.annual.socialSecurity, 6200);
  assert.equal(result.annual.medicare, 1450);
  assert.equal(result.available, true);
});
test('Traditional 401k reduces income tax wages but never FICA wages', () => {
  const result = calc(plan({ traditional401k: { kind: 'amount', value: 10000 } }));
  assert.equal(result.annual.federalTaxableIncome, 73900);
  assert.equal(result.annual.ficaWages, 100000);
  assert.equal(result.annual.socialSecurity, 6200);
});
test('health deductions and payroll HSA reduce both income and FICA wage bases', () => {
  const result = calc(
    plan({
      hsaCoverage: 'self',
      hsaAnnual: 4400,
      deductions: [
        {
          id: 'h',
          name: 'Health Insurance',
          kind: 'health',
          annualAmount: 2000,
          reducesIncomeTax: true,
          reducesFica: true,
        },
      ],
    }),
  );
  assert.equal(result.annual.ficaWages, 93600);
  assert.equal(result.annual.socialSecurity, 5803.2);
});
test('Social Security caps and Additional Medicare thresholds are year and filing specific', () => {
  const result = calc(plan({ annualSalary: 300000 }));
  assert.equal(result.annual.socialSecurity, 11439);
  assert.equal(result.annual.additionalMedicare, 900);
  assert.equal(result.annual.medicare, 5250);
});
test('401k contributions share one cap; Roth and Traditional do not each get a cap', () => {
  const result = calc(
    plan({ traditional401k: { kind: 'amount', value: 20000 }, roth401k: { kind: 'amount', value: 20000 } }),
  );
  assert.equal(result.annual.traditional401k + result.annual.roth401k, 24500);
});
test('age 60–63 catch-up replaces, rather than adds to, normal catch-up', () => {
  const result = calc(plan({ age: 61, traditional401k: { kind: 'amount', value: 40000 } }));
  assert.equal(result.annual.traditional401k + result.annual.roth401k, 35750);
});
test('high-earner catch-up becomes Roth when prior-year wages establish that rule', () => {
  const result = calc(plan({ age: 55, priorYearFicaWages: 160000, traditional401k: { kind: 'amount', value: 30000 } }));
  assert.equal(result.annual.traditional401k, 24500);
  assert.equal(result.annual.roth401k, 5500);
});
test('employer match and separate cash balance increase retirement/comp, not take-home', () => {
  const plain = calc(plan({ roth401k: { kind: 'percent', value: 10 } }));
  const matched = calc(
    plan({
      roth401k: { kind: 'percent', value: 10 },
      employerMatchTiers: [{ employeePercent: 4, matchPercent: 100 }],
      employerOtherContributionPercent: 3,
      employerOtherContributionName: 'Cash balance plan',
    }),
  );
  assert.equal(matched.annual.employerMatch, 4000);
  assert.equal(matched.annual.employerOtherContribution, 3000);
  assert.equal(matched.annual.totalComp, 107000);
  assert.equal(matched.annual.takeHome, plain.annual.takeHome);
  assert.equal(matched.annual.retirement - plain.annual.retirement, 7000);
});
test('Traditional IRA deductibility is independent of the cash contribution and payroll net', () => {
  const result = calc(plan({ traditionalIra: { kind: 'amount', value: 7500 }, coveredByWorkplacePlan: true }));
  assert.equal(result.annual.deductibleTraditionalIra, 0);
  assert.equal(result.annual.traditionalIra, 7500);
  assert.equal(result.annual.takeHome - result.annual.afterIra, 7500);
});
test('Roth IRA phaseout caps the contribution without inventing eligibility', () => {
  const result = calc(plan({ annualSalary: 180000, rothIra: { kind: 'amount', value: 7500 } }));
  assert.equal(result.annual.permittedRothIra, 0);
  assert.equal(result.annual.rothIra, 0);
});
test('investment amount and take-home percentage calculations agree in both directions', () => {
  const first = calc(plan({ savings: { kind: 'percent', basis: 'takeHome', value: 20 } }));
  const second = calc(plan({ savings: { kind: 'amount', value: first.annual.savings } }));
  assert.equal(first.annual.savings, second.annual.savings);
  assert.ok(Math.abs(first.allocationPercentages.savings.takeHome - 20) < 0.001);
});
test('all Sankey levels balance and every percentage uses total compensation', () => {
  const result = calc(
    plan({
      roth401k: { kind: 'percent', value: 10 },
      employerMatchTiers: [{ employeePercent: 4, matchPercent: 100 }],
      employerOtherContributionPercent: 3,
      savings: { kind: 'percent', basis: 'takeHome', value: 20 },
      investments: { kind: 'percent', basis: 'takeHome', value: 10 },
      savingsGoals: [
        { id: 'ef', name: 'Emergency Fund', percentOfSavings: 33.333333 },
        { id: 'car', name: 'Car Fund', percentOfSavings: 33.333333 },
        { id: 'vacation', name: 'Vacation Fund', percentOfSavings: 33.333334 },
      ],
    }),
  );
  assert.ok(result.flow);
  const check = (node) => {
    assert.ok(Math.abs(node.percentOfTotal - (node.amount / result.annual.totalComp) * 100) < 1e-8);
    if (node.children?.length) {
      assert.ok(Math.abs(node.children.reduce((s, c) => s + c.amount, 0) - node.amount) < 0.011);
      node.children.forEach(check);
    }
  };
  check(result.flow);
  assert.ok(Math.abs(result.allocations.reduce((s, r) => s + r.percent, 0) - 100) < 1e-8);
});
test('over-allocation keeps negative spendable visible and withholds misleading flow', () => {
  const result = calc(plan({ savings: { kind: 'amount', value: 200000 } }));
  assert.ok(result.annual.spendable < 0);
  assert.equal(result.flow, null);
});
test('unavailable historical tax years stay unavailable rather than borrowing2026 rules', () => {
  const result = calc(plan({ taxYear: 2022 }));
  assert.equal(result.available, false);
  assert.equal(result.annual.federalTax, null);
  assert.equal(result.annual.socialSecurity, null);
  assert.equal(result.annual.takeHome, null);
});
test('future assumptions are opt-in, labeled estimated, and do not overwrite published2026 data', () => {
  const result = calc(plan({ taxYear: 2030, allowEstimatedYear: true }));
  assert.equal(result.ruleStatus, 'estimated');
  assert.equal(result.available, true);
  assert.equal(TAX_RULES_2026.taxYear, 2026);
  assert.equal(TAX_RULES_2026.status, 'published');
});
test('malformed tax-rule updates fail validation instead of silently changing historical math', () => {
  const bad = structuredClone(TAX_RULES_2026);
  bad.federalBrackets.single[0].rate = 2;
  assert.ok(validateTaxRuleSet(bad).length);
  assert.throws(() => calc(plan({ customRules: bad })), /invalid tax rate/);
});
test('Maryland county tax requires verified taxable income and known locality', () => {
  const missing = calc(plan({ residenceState: 'MD', employmentState: 'MD' }));
  assert.equal(missing.available, false);
  const md = calc(
    plan({
      residenceState: 'MD',
      employmentState: 'MD',
      stateTaxableIncomeOverride: 100000,
      locality: 'Montgomery County',
    }),
  );
  assert.equal(md.available, true);
  assert.equal(md.annual.stateTax, 4697.5);
  assert.equal(md.annual.localTax, 3200);
});

test('Maryland locality normalization and tiered county schedules apply marginally', () => {
  const md = (extra) =>
    calc(plan({ residenceState: 'MD', employmentState: 'MD', stateTaxableIncomeOverride: 100000, ...extra }));
  assert.equal(md({ locality: 'Baltimore County' }).annual.localTax, 3200);
  assert.equal(md({ locality: 'Anne Arundel County' }).annual.localTax, 2820);
  assert.equal(md({ locality: 'Frederick County' }).annual.localTax, 2730);
  assert.equal(md({ locality: 'unknown' }).annual.localTax, null);
});

test('incomplete rule caches fail rather than producing a NaN financial total', () => {
  const bad = structuredClone(TAX_RULES_2026);
  delete bad.limits.ira;
  assert.ok(validateTaxRuleSet(bad).some((e) => e.includes('contribution limit: ira')));
  assert.throws(() => calc(plan({ customRules: bad })), /Invalid contribution limit/);
});
test('nonreciprocal interstate plans do not invent source-state credits', () => {
  const result = calc(plan({ residenceState: 'VA', employmentState: 'NC' }));
  assert.equal(result.annual.stateTax, null);
  assert.equal(result.available, false);
});
test('published WV2026 rate reduction and NC rate are used', () => {
  const wv = calc(plan({ residenceState: 'WV', employmentState: 'WV' }));
  assert.equal(wv.annual.stateTax, 3690.9);
  const nc = calc(plan({ residenceState: 'NC', employmentState: 'NC' }));
  assert.equal(nc.annual.stateTax, 3481.28);
});

test('Virginia joint senior spouse requires a verified taxable-income base', () => {
  const input = plan({ filingStatus: 'married_joint', age: 40, spouseAge: 65 });
  const missing = calc(input);
  assert.equal(missing.available, false);
  assert.equal(missing.annual.stateTaxableIncome, null);
  assert.equal(missing.annual.stateTax, null);
  assert.equal(missing.annual.takeHome, null);
  assert.equal(missing.flow, null);
  assert.ok(missing.warnings.some((w) => w.includes('Virginia age deduction')));
  const verified = calc({ ...input, stateTaxableIncomeOverride: 70000 });
  assert.equal(verified.available, true);
  assert.equal(verified.annual.stateTaxableIncome, 70000);
  assert.equal(verified.annual.stateTax, 3767.5);
});

test('West Virginia senior taxpayer or joint spouse requires verified taxable income', () => {
  for (const profile of [{ age: 65 }, { filingStatus: 'married_joint', age: 40, spouseAge: 65 }]) {
    const input = plan({ residenceState: 'WV', employmentState: 'WV', ...profile });
    const missing = calc(input);
    assert.equal(missing.available, false);
    assert.equal(missing.annual.stateTaxableIncome, null);
    assert.equal(missing.annual.stateTax, null);
    assert.equal(missing.annual.takeHome, null);
    assert.equal(missing.flow, null);
    assert.ok(missing.warnings.some((w) => w.includes('West Virginia senior')));
    const verified = calc({ ...input, stateTaxableIncomeOverride: 70000 });
    assert.equal(verified.available, true);
    assert.equal(verified.annual.stateTaxableIncome, 70000);
    assert.equal(verified.annual.stateTax, 2408.5);
  }
});
test('withholding is not guessed when absent and is compared with income-tax liability only', () => {
  assert.equal(calc(plan({})).withholding.projectedRefund, null);
  const result = calc(
    plan({ actualFederalWithholding: 20000, actualStateWithholding: 6000, actualLocalWithholding: 0 }),
  );
  assert.equal(result.withholding.projectedRefund, 7894.1);
});
test('zero-return projection separates starting balance and future contributions', () => {
  const result = projectWealth({
    years: 10,
    startingBalance: 1000,
    annualContribution: 1200,
    contributionFrequency: 'monthly',
    annualReturnPercent: 0,
    salaryGrowthPercent: 0,
    inflationPercent: 0,
  });
  for (const scenario of result.scenarios) {
    const last = scenario.points.at(-1);
    assert.equal(last.value, 13000);
    assert.equal(last.newContributions, 12000);
    assert.equal(last.returns, 0);
  }
});
test('effective-annual return compounds consistently across contribution schedules', () => {
  const result = projectWealth({
    years: 1,
    startingBalance: 1000,
    annualContribution: 1200,
    contributionFrequency: 'annual',
    annualReturnPercent: 10,
    salaryGrowthPercent: 0,
    inflationPercent: 0,
  });
  assert.equal(result.scenarios.find((s) => s.frequency === 'annual').points.at(-1).value, 2300);
  assert.ok(result.scenarios.find((s) => s.frequency === 'monthly').points.at(-1).value > 2300);
});
test('calculation never mutates user inputs or cached published tax rules', () => {
  const input = plan({});
  const before = JSON.stringify(input),
    rulesBefore = JSON.stringify(TAX_RULES_2026);
  calc(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(TAX_RULES_2026), rulesBefore);
});
