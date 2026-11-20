<script setup lang="ts">
import {
  getIncomeDashboard,
  getIncomeTaxData,
  refreshIncomeTaxData,
  saveIncomeDocument,
} from '@/api/income-management';
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { Callout } from '@/components/lib/ui/callout';
import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue';
import { calculateIncomePlan, createDefaultIncomePlan, type IncomePlanInput } from '@bt/shared/finance-income';
import type { IncomeDocument, IncomePlanVersion } from '@bt/shared/types/income-management';
import { computed, onMounted, ref } from 'vue';
import AmountInput from './amount-input.vue';
const emit = defineEmits<{ saved: []; cancel: [] }>();
const settingsSection = ref<'income' | 'retirement' | 'savings' | 'taxes' | 'deductions'>('retirement');

const document = ref<IncomeDocument>({ revision: 0, employers: [], paychecks: [], plans: [] });
const input = ref<IncomePlanInput>(createDefaultIncomePlan());
const selected = ref('new'),
  name = ref('Current planning scenario'),
  employerId = ref(''),
  effectiveFrom = ref(''),
  effectiveTo = ref(''),
  notes = ref('');
const evidence = ref<'estimated' | 'projected'>('estimated');
const loading = ref(true),
  busy = ref(false),
  error = ref(''),
  notice = ref('');
const taxData = ref<Awaited<ReturnType<typeof getIncomeTaxData>> | null>(null);
const calculation = computed(() => {
  try {
    const numericKeys = [
      'taxYear',
      'age',
      'spouseAge',
      'priorYearFicaWages',
      'dependents',
      'childTaxCreditEligibleChildren',
      'otherDependentCreditEligibleCount',
      'spouseWagesIncluded',
      'annualSalary',
      'annualBonus',
      'otherOrdinaryIncome',
      'hsaAnnual',
      'employerBaseContributionPercent',
      'employerOtherContributionPercent',
      'federalItemizedDeduction',
      'stateItemizedDeduction',
      'federalAdjustments',
      'stateAdjustments',
      'federalCredits',
      'stateCredits',
      'stateTaxableIncomeOverride',
      'localAnnualTaxOverride',
      'actualFederalWithholding',
      'actualStateWithholding',
      'actualLocalWithholding',
      'actualSocialSecurityWithholding',
      'actualMedicareWithholding',
      'iraModifiedAgiOverride',
    ] as const;
    const values = [
      ...numericKeys.map((key) => input.value[key]),
      ...(['traditional401k', 'roth401k', 'traditionalIra', 'rothIra', 'investments', 'savings'] as const).map(
        (key) => input.value[key].value,
      ),
      ...input.value.deductions.map((item) => item.annualAmount),
      ...input.value.employerMatchTiers.flatMap((item) => [item.employeePercent, item.matchPercent]),
      ...(input.value.savingsGoals ?? []).map((item) => item.percentOfSavings),
    ];
    if (
      values.some((value) => value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0))
    )
      throw new Error('Enter valid nonnegative numbers in the planning fields. Required fields cannot be blank.');
    return { result: calculateIncomePlan(input.value), error: '' };
  } catch (cause) {
    return { result: null, error: cause instanceof Error ? cause.message : 'Check the planning inputs.' };
  }
});
const result = computed(() => calculation.value.result);
const field = 'border-input bg-background h-10 w-full rounded-md border px-3 text-sm';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const money = (amount: number | null | undefined) =>
  amount == null
    ? 'Unavailable'
    : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount);
const percent = (value: number | null | undefined) => (value == null ? 'Unavailable' : value.toFixed(2) + '%');
function choose() {
  const plan = document.value.plans.find((p) => p.id === selected.value);
  if (!plan) {
    input.value = createDefaultIncomePlan();
    name.value = 'New planning scenario';
    employerId.value = '';
    effectiveFrom.value = '';
    effectiveTo.value = '';
    notes.value = '';
    evidence.value = 'projected';
    return;
  }
  input.value = clone(plan.input);
  name.value = plan.name;
  employerId.value = plan.employerId ?? '';
  effectiveFrom.value = plan.effectiveFrom ?? '';
  effectiveTo.value = plan.effectiveTo ?? '';
  notes.value = plan.notes;
  evidence.value = plan.evidence;
}
async function load() {
  try {
    const [data, rules] = await Promise.all([getIncomeDashboard(), getIncomeTaxData()]);
    document.value = data.document;
    taxData.value = rules;
    if (data.document.plans.length) {
      const today = new Date().toLocaleDateString('en-CA');
      selected.value =
        [...data.document.plans]
          .filter(
            (p) =>
              p.evidence !== 'projected' &&
              (!p.effectiveFrom || p.effectiveFrom <= today) &&
              (!p.effectiveTo || p.effectiveTo >= today),
          )
          .sort((a, b) => (a.effectiveFrom ?? '').localeCompare(b.effectiveFrom ?? ''))
          .at(-1)?.id ?? 'new';
      choose();
    }
  } catch {
    error.value = 'Income planning could not be loaded. Your saved records were not changed.';
  } finally {
    loading.value = false;
  }
}
async function save(asNew = false) {
  if (!result.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const id = asNew || selected.value === 'new' ? crypto.randomUUID() : selected.value;
    const plan: IncomePlanVersion = {
      id,
      employerId: employerId.value || null,
      name: name.value,
      effectiveFrom: effectiveFrom.value || null,
      effectiveTo: effectiveTo.value || null,
      input: clone(input.value),
      notes: notes.value,
      evidence: evidence.value,
    };
    const next = { ...document.value, plans: [...document.value.plans.filter((p) => p.id !== id), plan] };
    document.value = await saveIncomeDocument(next);
    selected.value = id;
    emit('saved');
    notice.value = 'Planning inputs saved. Actual paychecks and historical balances were not changed.';
  } catch {
    error.value = 'Unable to save. Check inputs and reload if this record changed in another window.';
  } finally {
    busy.value = false;
  }
}
async function refresh() {
  busy.value = true;
  try {
    await refreshIncomeTaxData();
    taxData.value = await getIncomeTaxData();
    notice.value =
      'Official sources checked. Cached tax-year rules remain versioned; changed pages require validated rule updates.';
  } catch {
    error.value = 'Some tax sources could not be checked. Cached tax rules remain available.';
  } finally {
    busy.value = false;
  }
}
function addDeduction() {
  input.value.deductions.push({
    id: crypto.randomUUID(),
    name: 'Health Insurance',
    annualAmount: 0,
    kind: 'health',
    reducesIncomeTax: true,
    reducesFica: true,
  });
}
function addSavingsGoal() {
  (input.value.savingsGoals ??= []).push({ id: crypto.randomUUID(), name: 'Other savings', percentOfSavings: 0 });
}
onMounted(load);
</script>
<template>
  <div class="space-y-5">
    <div class="flex flex-wrap gap-1" role="group" aria-label="Income settings section">
      <Button
        v-for="[key, label] in [
          ['income', 'Income and compensation'],
          ['retirement', 'Retirement'],
          ['savings', 'Savings'],
          ['taxes', 'Tax settings'],
          ['deductions', 'Payroll deductions'],
        ] as const"
        :key="key"
        size="sm"
        :variant="settingsSection === key ? 'secondary' : 'ghost'"
        :aria-pressed="settingsSection === key"
        @click="settingsSection = key"
        >{{ label }}</Button
      >
    </div>
    <p class="text-muted-foreground text-xs">Using your saved yearly salary of {{ money(input.annualSalary) }}.</p>
    <Callout v-if="calculation.error" variant="destructive" role="alert"
      >{{ calculation.error }} Calculated outputs are hidden until these inputs are corrected.</Callout
    >
    <Callout v-if="error" variant="destructive">{{ error }}</Callout
    ><Callout v-if="notice">{{ notice }}</Callout>
    <p v-if="loading" class="text-muted-foreground">Loading income planning…</p>
    <template v-else>
      <div :class="['grid gap-5', settingsSection === 'retirement' && 'lg:grid-cols-2']">
        <Card v-if="settingsSection === 'income'" class="space-y-4 p-5">
          <h2 class="font-semibold">Income and compensation</h2>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="space-y-1 text-sm"
              >Gross Yearly Salary<input
                v-model.number="input.annualSalary"
                type="number"
                min="0"
                step="0.01"
                :class="field"
            /></label>
            <label class="space-y-1 text-sm"
              >Projected Yearly Bonus<input
                v-model.number="input.annualBonus"
                type="number"
                min="0"
                step="0.01"
                :class="field"
            /></label>
            <label class="space-y-1 text-sm"
              >Pay frequency<select v-model="input.payFrequency" :class="field" aria-label="Pay frequency">
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="semimonthly">Twice monthly</option>
                <option value="monthly">Monthly</option>
                <option value="annual">Yearly</option>
              </select></label
            >
            <label class="space-y-1 text-sm"
              >Other ordinary income<input
                v-model.number="input.otherOrdinaryIncome"
                type="number"
                min="0"
                :class="field"
            /></label>
          </div>
        </Card>
        <Card v-if="settingsSection === 'retirement'" class="space-y-4 p-5"
          ><h2 class="font-semibold">Employer 401(k) match</h2>
          <div
            v-for="(tier, index) in input.employerMatchTiers"
            :key="index"
            class="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
          >
            <label class="text-xs"
              >Employee contribution %<input
                v-model.number="tier.employeePercent"
                type="number"
                min="0"
                :class="field" /></label
            ><label class="text-xs"
              >Employer matching %<input
                v-model.number="tier.matchPercent"
                type="number"
                min="0"
                :class="field" /></label
            ><Button variant="ghost" @click="input.employerMatchTiers.splice(index, 1)">Remove</Button>
          </div>
          <Button variant="outline" @click="input.employerMatchTiers.push({ employeePercent: 0, matchPercent: 100 })"
            >Add match tier</Button
          >
          <label class="block space-y-1 text-sm"
            >Employer 401(k) match %<input
              v-model.number="input.employerBaseContributionPercent"
              type="number"
              min="0"
              :class="field"
          /></label>
          <label class="block space-y-1 text-sm"
            >Other employer retirement contribution %<input
              v-model.number="input.employerOtherContributionPercent"
              type="number"
              min="0"
              :class="field"
          /></label>
          <label class="flex items-center gap-2 text-sm"
            ><input v-model="input.employerMatchEligibleBonus" type="checkbox" /> Bonus is eligible for employer
            matching</label
          >
          <dl v-if="result" class="bg-muted/40 grid grid-cols-2 gap-2 rounded-md p-3 text-sm">
            <dt>Company 401k Match $</dt>
            <dd class="text-right font-medium">{{ money(result.annual.employerMatch) }}</dd>
            <dt>Total Comp</dt>
            <dd class="text-right font-semibold">{{ money(result.annual.totalComp) }}</dd>
          </dl>
        </Card>
        <Card v-if="settingsSection === 'taxes'" class="space-y-4 p-5"
          ><h2 class="font-semibold">Tax profile</h2>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-1 text-sm">
              <span>Tax year</span>
              <div class="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Previous tax year"
                  :disabled="input.taxYear <= 1900"
                  @click="input.taxYear--"
                  ><ChevronLeftIcon class="size-4" /></Button
                ><span class="font-semibold">{{ input.taxYear }}</span
                ><Button
                  variant="ghost"
                  size="sm"
                  aria-label="Next tax year"
                  :disabled="input.taxYear >= 2200"
                  @click="input.taxYear++"
                  ><ChevronRightIcon class="size-4"
                /></Button>
              </div>
            </div>
            <label class="space-y-1 text-sm"
              >Filing status<select v-model="input.filingStatus" :class="field">
                <option value="single">Single</option>
                <option value="married_joint">Married filing jointly</option>
                <option value="married_separate">Married filing separately</option>
                <option value="head_household">Head of household</option>
              </select></label
            >
            <label class="space-y-1 text-sm"
              >Age<input v-model.number="input.age" type="number" min="0" :class="field"
            /></label>
            <label class="space-y-1 text-sm"
              >Dependents<input v-model.number="input.dependents" type="number" min="0" :class="field"
            /></label>
            <label class="space-y-1 text-sm"
              >Residence state<select v-model="input.residenceState" :class="field">
                <option v-for="state in ['VA', 'DC', 'MD', 'WV', 'NC']" :key="state">{{ state }}</option>
              </select></label
            >
            <label class="space-y-1 text-sm"
              >Employment state<select v-model="input.employmentState" :class="field">
                <option v-for="state in ['VA', 'DC', 'MD', 'WV', 'NC']" :key="state">{{ state }}</option>
              </select></label
            >
            <label class="space-y-1 text-sm"
              >County / city (when applicable)<input v-model="input.locality" :class="field"
            /></label>
            <label class="space-y-1 text-sm"
              >Deduction method<select v-model="input.deductionMethod" :class="field">
                <option value="standard">Standard deduction</option>
                <option value="itemized">Itemized deductions</option>
              </select></label
            >
            <label v-if="input.deductionMethod === 'itemized'" class="space-y-1 text-sm"
              >Federal itemized deductions<input
                v-model.number="input.federalItemizedDeduction"
                type="number"
                min="0"
                :class="field"
            /></label>
          </div>
          <label class="flex items-center gap-2 text-sm"
            ><input v-model="input.coveredByWorkplacePlan" type="checkbox" /> Covered by a workplace retirement
            plan</label
          >
          <dl v-if="result" class="divide-border/50 divide-y text-sm">
            <div class="flex justify-between gap-4 py-2">
              <dt>Effective Tax Rate %</dt>
              <dd>{{ percent(result.rates.totalEffective) }}</dd>
            </div>
            <div class="flex justify-between gap-4 py-2">
              <dt>Total Federal Tax $</dt>
              <dd>{{ money(result.annual.federalTax) }}</dd>
            </div>
            <div class="flex justify-between gap-4 py-2">
              <dt>State Income Tax % (marginal)</dt>
              <dd>{{ percent(result.rates.stateMarginal === null ? null : result.rates.stateMarginal * 100) }}</dd>
            </div>
            <div class="flex justify-between gap-4 py-2">
              <dt>State Income Tax $</dt>
              <dd>{{ money(result.annual.stateTax) }}</dd>
            </div>
            <div class="flex justify-between gap-4 py-2">
              <dt>Local Income Tax</dt>
              <dd>{{ money(result.annual.localTax) }}</dd>
            </div>
            <div class="flex justify-between gap-4 py-2">
              <dt>Social Security $</dt>
              <dd>{{ money(result.annual.socialSecurity) }}</dd>
            </div>
            <div class="flex justify-between gap-4 py-2">
              <dt>Medicare $</dt>
              <dd>{{ money(result.annual.medicare) }}</dd>
            </div>
            <div class="flex justify-between gap-4 py-2 font-semibold">
              <dt>Net / Yearly Salary After Taxes</dt>
              <dd>{{ money(result.annual.net) }}</dd>
            </div>
          </dl>
        </Card>
        <Card v-if="settingsSection === 'retirement'" class="space-y-5 p-5"
          ><h2 class="font-semibold">Your retirement contributions</h2>
          <AmountInput
            v-model="input.traditional401k"
            label="Trad 401k Contribution"
            :gross="result?.annual.gross"
            :net="result?.annual.net"
            :take-home="result?.annual.takeHome"
            :dollars="result?.annual.traditional401k"
          />
          <AmountInput
            v-model="input.roth401k"
            label="Roth 401k Contribution"
            :gross="result?.annual.gross"
            :net="result?.annual.net"
            :take-home="result?.annual.takeHome"
            :dollars="result?.annual.roth401k"
          />
          <AmountInput
            v-model="input.traditionalIra"
            label="Trad IRA Contribution"
            :gross="result?.annual.gross"
            :net="result?.annual.net"
            :take-home="result?.annual.takeHome"
            :dollars="result?.annual.traditionalIra"
          />
          <AmountInput
            v-model="input.rothIra"
            label="Roth IRA Contribution"
            :gross="result?.annual.gross"
            :net="result?.annual.net"
            :take-home="result?.annual.takeHome"
            :dollars="result?.annual.rothIra"
          />
          <p class="text-muted-foreground text-xs">
            Traditional IRA deductibility is evaluated separately from payroll deductions. IRA contributions reduce
            available cash even when they are not deductible.
          </p>
        </Card>
        <Card v-if="settingsSection === 'savings'" class="space-y-5 p-5"
          ><h2 class="font-semibold">Savings and investments</h2>
          <AmountInput
            v-model="input.investments"
            label="Investments"
            :gross="result?.annual.gross"
            :net="result?.annual.net"
            :take-home="result?.annual.takeHome"
            :dollars="result?.annual.investments"
          />
          <AmountInput
            v-model="input.savings"
            label="Savings"
            :gross="result?.annual.gross"
            :net="result?.annual.net"
            :take-home="result?.annual.takeHome"
            :dollars="result?.annual.savings"
          />
          <div
            v-for="(goal, index) in input.savingsGoals"
            :key="goal.id"
            class="grid grid-cols-[1fr_6rem_auto] items-center gap-2"
          >
            <input v-model="goal.name" :class="field" aria-label="Savings goal name" /><input
              v-model.number="goal.percentOfSavings"
              type="number"
              min="0"
              max="100"
              :class="field"
              aria-label="Percent of savings"
            /><Button variant="ghost" @click="input.savingsGoals?.splice(index, 1)">Remove</Button>
          </div>
          <Button variant="outline" @click="addSavingsGoal">Add savings goal</Button>
          <dl v-if="result" class="bg-muted/40 grid grid-cols-2 gap-2 rounded-md p-3 text-sm">
            <dt>Take Home / Net / Post-Deductions</dt>
            <dd class="text-right">{{ money(result.annual.takeHome) }}</dd>
            <dt>Disposable Income / Spendable</dt>
            <dd class="text-right text-lg font-semibold">{{ money(result.annual.spendable) }}</dd>
          </dl>
        </Card>
      </div>
      <Card v-if="settingsSection === 'deductions'" class="space-y-4 p-5"
        ><h2 class="font-semibold">HSA and payroll deductions</h2>
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="space-y-1 text-sm"
            >Annual HSA contribution<input
              v-model.number="input.hsaAnnual"
              type="number"
              min="0"
              :class="field" /></label
          ><label class="space-y-1 text-sm"
            >HSA coverage<select v-model="input.hsaCoverage" :class="field">
              <option value="none">None</option>
              <option value="self">Self-only</option>
              <option value="family">Family</option>
            </select></label
          ><label class="flex items-center gap-2 text-sm"
            ><input v-model="input.hsaThroughPayroll" type="checkbox" /> HSA deducted through payroll</label
          >
        </div>
        <div
          v-for="(deduction, index) in input.deductions"
          :key="deduction.id"
          class="border-border grid items-end gap-3 border-t pt-3 sm:grid-cols-3 lg:grid-cols-6"
        >
          <label class="text-xs">Deduction<input v-model="deduction.name" :class="field" /></label
          ><label class="text-xs"
            >Type<select v-model="deduction.kind" :class="field">
              <option v-for="kind in ['health', 'dental', 'vision', 'fsa', 'other']" :key="kind">{{ kind }}</option>
            </select></label
          ><label class="text-xs"
            >Yearly $<input v-model.number="deduction.annualAmount" type="number" min="0" :class="field" /></label
          ><label class="flex items-center gap-2 text-xs"
            ><input v-model="deduction.reducesIncomeTax" type="checkbox" /> Reduces income tax</label
          ><label class="flex items-center gap-2 text-xs"
            ><input v-model="deduction.reducesFica" type="checkbox" /> Reduces FICA</label
          ><Button variant="ghost" @click="input.deductions.splice(index, 1)">Remove</Button>
        </div>
        <Button variant="outline" @click="addDeduction">Add deduction</Button>
      </Card>
      <Card v-if="settingsSection === 'taxes'" class="space-y-4 p-5"
        ><details>
          <summary class="cursor-pointer font-medium">Verified withholding, credits and adjustments</summary>
          <div class="mt-4 grid gap-4 sm:grid-cols-3">
            <label
              v-for="key in [
                'actualFederalWithholding',
                'actualStateWithholding',
                'actualLocalWithholding',
                'federalAdjustments',
                'stateAdjustments',
                'federalCredits',
                'stateCredits',
                'localAnnualTaxOverride',
              ] as const"
              :key="key"
              class="space-y-1 text-xs"
              >{{ key.replace(/([A-Z])/g, ' $1')
              }}<input
                :value="input[key]"
                type="number"
                min="0"
                :class="field"
                @input="
                  input[key] =
                    ($event.target as HTMLInputElement).value === ''
                      ? undefined
                      : Number(($event.target as HTMLInputElement).value)
                "
            /></label>
          </div>
          <p class="text-muted-foreground mt-3 text-xs">
            Leave unknown actual withholding blank. Overrides must come from verified values and are labelled as
            overrides in calculation warnings.
          </p>
        </details></Card
      >
      <Callout v-if="settingsSection === 'taxes' && result?.warnings.length"
        ><ul class="list-disc space-y-1 pl-4">
          <li v-for="warning in result.warnings" :key="warning">{{ warning }}</li>
        </ul></Callout
      >
      <div class="bg-background border-border/60 sticky bottom-0 flex flex-wrap justify-end gap-3 border-t py-3">
        <Button variant="ghost" @click="emit('cancel')">Cancel</Button
        ><Button :disabled="busy || !name.trim() || !result" @click="save(false)">Save changes</Button>
      </div>
      <details v-if="settingsSection === 'taxes' && taxData" class="text-sm">
        <summary class="text-muted-foreground cursor-pointer">Tax sources</summary>
        <Button size="sm" variant="ghost" :disabled="busy" @click="refresh">Refresh tax data</Button>
        <p class="my-3 text-xs">{{ taxData.policy }}</p>
        <p v-if="taxData.latestCheck" class="text-xs">Last source check: {{ taxData.latestCheck.createdAt }}</p>
        <ul v-if="result" class="mt-2 space-y-1">
          <li v-for="source in result.sources" :key="source.url">
            <a :href="source.url" target="_blank" rel="noopener noreferrer" class="text-primary underline">{{
              source.title
            }}</a>
            <span class="text-muted-foreground text-xs">{{ source.checkedAt }}</span>
          </li>
        </ul>
      </details>
    </template>
  </div>
</template>
