<script setup lang="ts">
import { getIncomeDashboard, saveIncomeDocument } from '@/api/income-management';
import { Card } from '@/components/lib/ui/card';
import { Callout } from '@/components/lib/ui/callout';
import { Button } from '@/components/lib/ui/button';
import FinanceChart, { type ChartRow, type ChartSeries } from '@/pages/personal-finance/finance-chart.vue';
import MoneyFlowChart from '@/pages/analytics/subpages/cash-flow/components/money-flow-chart.vue';
import type { MoneyFlow } from '@/pages/analytics/subpages/cash-flow/utils/build-money-flow';
import { projectWealth, type IncomePlanResult, type WealthProjectionInput } from '@bt/shared/finance-income';
import type { IncomeDashboard } from '@bt/shared/types/income-management';
import { computed, onMounted, ref } from 'vue';

const props = defineProps<{ mode: 'income' | 'taxes' }>();
const data = ref<IncomeDashboard | null>(null),
  error = ref(''),
  busy = ref(false),
  year = ref(new Date().getFullYear());
const selected = ref(''),
  evidence = ref<'actual' | 'estimated' | 'projected'>('actual'),
  period = ref<'biweekly' | 'monthly' | 'yearly'>('yearly');
const displayMode = ref<'percent' | 'amount' | 'both'>('percent'),
  activeTab = ref<'history' | 'allocation' | 'projections'>('history');
const historyPeriod = ref<'biweekly' | 'monthly' | 'yearly'>('monthly');
const divisor = computed(() => (period.value === 'biweekly' ? 26 : period.value === 'monthly' ? 12 : 1));
const plan = computed(() => data.value?.calculations.find((item) => item.plan.id === selected.value) ?? null);
const result = computed<IncomePlanResult | null>(() => plan.value?.result ?? null);
const field = 'border-input bg-background h-10 rounded-md border px-3 text-sm';
const money = (n: number | null | undefined) =>
  n == null ? 'Unavailable' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
const percent = (n: number | null | undefined) => (n == null ? 'Unavailable' : n.toFixed(2) + '%');
const dummy: MoneyFlow = {
  income: 0,
  expenses: 0,
  net: 0,
  taxes: 0,
  savings: 0,
  deficit: 0,
  sources: [],
  expenseNodes: [],
  expenseGroups: [],
  taxNodes: [],
  savingsNodes: [],
};
const incomeSeries: ChartSeries[] = [
  { id: 'gross', name: 'Gross income', color: '#7b65c1' },
  { id: 'net', name: 'Net recorded income', color: '#6cb98e' },
  { id: 'bonus', name: 'Bonuses', color: '#e0a11e' },
  { id: 'comp', name: 'Total Compensation', color: '#5b83ed' },
  { id: 'spendable', name: 'Spendable income', color: '#db70af' },
];
const taxSeries: ChartSeries[] = [
  { id: 'federal', name: 'Federal', color: '#e77066' },
  { id: 'state', name: 'State', color: '#e0a11e' },
  { id: 'local', name: 'Local', color: '#db70af' },
  { id: 'socialSecurity', name: 'Social Security', color: '#7b65c1' },
  { id: 'medicare', name: 'Medicare', color: '#5b83ed' },
];
const chartRows = computed<ChartRow[]>(() => {
  if (!data.value) return [];
  if (evidence.value === 'actual')
    return data.value.periods.map(
      (p): ChartRow => ({
        label: p.date,
        values:
          props.mode === 'income'
            ? {
                gross: p.gross,
                net: p.actualNet,
                bonus: p.bonus,
                comp: p.gross === null || p.employerContributions === null ? null : p.gross + p.employerContributions,
                spendable: null,
              }
            : {
                federal: p.federal,
                state: p.state,
                local: p.local,
                socialSecurity: p.socialSecurity,
                medicare: p.medicare,
              },
      }),
    );
  const versions = data.value.calculations.filter(
    (p) =>
      p.plan.id === selected.value &&
      p.plan.evidence === evidence.value &&
      p.plan.effectiveFrom &&
      p.result.available &&
      p.result.taxYear === year.value,
  );
  const rows: ChartRow[] = [];
  for (let month = 0; month < 12; month++) {
    const date = `${year.value}-${String(month + 1).padStart(2, '0')}-01`;
    const candidates = versions
      .filter((p) => p.plan.effectiveFrom! <= date && (!p.plan.effectiveTo || p.plan.effectiveTo >= date))
      .sort((a, b) => a.plan.effectiveFrom!.localeCompare(b.plan.effectiveFrom!));
    const chosen = candidates.at(-1);
    if (!chosen) continue;
    const a = chosen.result.annual;
    rows.push({
      label: date,
      values:
        props.mode === 'income'
          ? {
              gross: a.gross / 12,
              net: a.net === null ? null : a.net / 12,
              bonus: a.bonus / 12,
              comp: a.totalComp / 12,
              spendable: a.spendable === null ? null : a.spendable / 12,
            }
          : {
              federal: a.federalTax === null ? null : a.federalTax / 12,
              state: a.stateTax === null ? null : a.stateTax / 12,
              local: a.localTax === null ? null : a.localTax / 12,
              socialSecurity: a.socialSecurity === null ? null : a.socialSecurity / 12,
              medicare: a.medicare === null ? null : a.medicare / 12,
            },
    });
  }
  return rows;
});
const incoming = computed(() =>
  result.value
    ? [
        { name: 'Salary', amount: result.value.annual.salary },
        { name: 'Bonuses', amount: result.value.annual.bonus },
        {
          name: 'Employer contributions',
          amount: result.value.annual.employerMatch + result.value.annual.employerOtherContribution,
        },
      ]
    : [],
);
const projection = ref<WealthProjectionInput>({
  years: 10,
  startingBalance: 0,
  annualContribution: 0,
  contributionFrequency: 'biweekly',
  annualReturnPercent: 0,
  salaryGrowthPercent: 0,
  inflationPercent: 0,
});
const projectionId = ref('custom'),
  projectionName = ref('New projection scenario');
const projectionNotes = computed(
  () => data.value?.document.projections?.find((p) => p.id === projectionId.value)?.notes ?? '',
);
const comparison = ref<{ name: string; input: WealthProjectionInput }[]>([]);
const projectionResult = computed(() => {
  try {
    return projectWealth(projection.value);
  } catch {
    return null;
  }
});
const projectionRows = computed<ChartRow[]>(
  () =>
    projectionResult.value?.scenarios[0]?.points.map((p, index) => ({
      label: `Year ${p.year}`,
      values: {
        contributions: p.contributions,
        ...Object.fromEntries(projectionResult.value!.scenarios.map((s) => [s.frequency, s.points[index]!.value])),
      },
    })) ?? [],
);
const projectionSeries: ChartSeries[] = [
  { id: 'contributions', name: 'Without interest', color: '#a8a29e' },
  { id: 'biweekly', name: 'Biweekly investing', color: '#7b65c1' },
  { id: 'monthly', name: 'Monthly investing', color: '#6cb98e' },
  { id: 'annual', name: 'Yearly investing', color: '#e0a11e' },
];
const finalProjection = computed(() =>
  projectionResult.value?.scenarios.find((s) => s.frequency === projection.value.contributionFrequency)?.points.at(-1),
);
const savedProjectionResults = computed(() =>
  (data.value?.document.projections ?? []).map((s) => {
    try {
      return {
        ...s,
        result:
          projectWealth(s.input)
            .scenarios.find((p) => p.frequency === s.input.contributionFrequency)
            ?.points.at(-1) ?? null,
      };
    } catch {
      return { ...s, result: null };
    }
  }),
);
const combinedScenarioIds = ref<string[]>([]);
const combinedProjection = computed(() => {
  const items = savedProjectionResults.value.filter((item) => combinedScenarioIds.value.includes(item.id));
  if (!items.length || items.some((s) => !s.result) || new Set(items.map((s) => s.input.years)).size !== 1) return null;
  return {
    years: items[0]!.input.years,
    value: items.reduce((sum, s) => sum + s.result!.value, 0),
    contributions: items.reduce((sum, s) => sum + s.result!.contributions, 0),
    returns: items.reduce((sum, s) => sum + s.result!.returns, 0),
  };
});
async function load() {
  busy.value = true;
  error.value = '';
  try {
    data.value = await getIncomeDashboard(`${year.value}-01-01`, `${year.value}-12-31`, historyPeriod.value);
    selected.value ||= data.value.calculations.at(-1)?.plan.id ?? '';
  } catch {
    error.value = 'Income reports could not be loaded. Stored financial records were not changed.';
  } finally {
    busy.value = false;
  }
}
function usePlanContributions() {
  if (!result.value) return;
  projection.value.annualContribution =
    (result.value.annual.savings ?? 0) +
    (result.value.annual.investments ?? 0) +
    result.value.annual.retirement +
    result.value.annual.hsa;
}
function saveComparison() {
  if (!projectionResult.value) return;
  comparison.value.push({
    name: `Scenario ${comparison.value.length + 1}`,
    input: JSON.parse(JSON.stringify(projection.value)),
  });
}
function chooseProjection() {
  const item = data.value?.document.projections?.find((s) => s.id === projectionId.value);
  if (item) {
    projection.value = JSON.parse(JSON.stringify(item.input));
    projectionName.value = item.name;
  }
}
async function persistProjection() {
  if (!data.value || !projectionResult.value) return;
  busy.value = true;
  try {
    const id = projectionId.value === 'custom' ? crypto.randomUUID() : projectionId.value;
    const item = {
      id,
      name: projectionName.value,
      input: JSON.parse(JSON.stringify(projection.value)),
      notes: projectionNotes.value,
    };
    data.value.document = await saveIncomeDocument({
      ...data.value.document,
      projections: [...(data.value.document.projections ?? []).filter((p) => p.id !== id), item],
    });
    projectionId.value = id;
  } catch {
    error.value = 'Projection inputs could not be saved. Reload before trying again.';
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
<template>
  <div class="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">{{ mode === 'income' ? 'Income reports' : 'Tax reports' }}</h1>
        <p class="text-muted-foreground mt-1 text-sm">Recorded history and planning scenarios remain separate.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <input
          v-model.number="year"
          type="number"
          min="1900"
          max="2200"
          aria-label="Report year"
          :class="field + ' w-28'"
        /><Button variant="outline" :disabled="busy" @click="load">Load year</Button>
      </div>
    </div>
    <Callout v-if="error" variant="destructive">{{ error }}</Callout>
    <div class="flex flex-wrap gap-2">
      <Button :variant="activeTab === 'history' ? 'default' : 'outline'" @click="activeTab = 'history'">History</Button
      ><Button :variant="activeTab === 'allocation' ? 'default' : 'outline'" @click="activeTab = 'allocation'"
        >Allocation and breakdown</Button
      ><Button
        v-if="mode === 'income'"
        :variant="activeTab === 'projections' ? 'default' : 'outline'"
        @click="activeTab = 'projections'"
        >Financial projections</Button
      >
    </div>
    <template v-if="data">
      <template v-if="activeTab === 'history'">
        <div class="flex flex-wrap items-center gap-3">
          <label class="text-sm"
            >Evidence
            <select v-model="evidence" :class="field">
              <option value="actual">Actual recorded income</option>
              <option value="estimated">Estimated dated salary plans</option>
              <option value="projected">Projected dated scenarios</option>
            </select></label
          ><label v-if="evidence === 'actual'" class="text-sm"
            >Period
            <select v-model="historyPeriod" :class="field" @change="load">
              <option value="biweekly">Biweekly (14-day groups)</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select></label
          ><select v-else v-model="selected" aria-label="History scenario" :class="field">
            <option
              v-for="item in data.calculations.filter((c) => c.plan.evidence === evidence)"
              :key="item.plan.id"
              :value="item.plan.id"
            >
              {{ item.plan.name }}
            </option></select
          ><Button as-child variant="outline"><router-link to="/finances/income">Manage income</router-link></Button>
        </div>
        <Callout v-if="evidence === 'actual'"
          >Actual net income comes from posted bank deposits and reconciled manual paychecks. Gross, withholding and
          spendable values remain unavailable when their source details are missing; salary estimates never fill
          historical gaps. Biweekly groups are calendar 14-day buckets, not inferred employer pay dates.</Callout
        ><Callout v-else
          >Only the selected scenario with known effective dates contributes to this chart. Scenarios and employers are
          never added together implicitly. These are annualized monthly estimates, not actual paycheck observations.
          Undated Sheet planning snapshots appear in the allocation view instead.</Callout
        >
        <div v-if="mode === 'income'" class="grid gap-4 sm:grid-cols-3">
          <Card class="p-5"
            ><p class="text-muted-foreground text-sm">Actual net income</p>
            <p class="mt-2 text-2xl font-semibold">{{ money(data.currentBehavior.actualIncome) }}</p></Card
          ><Card class="p-5"
            ><p class="text-muted-foreground text-sm">Known gross income</p>
            <p class="mt-2 text-2xl font-semibold">{{ money(data.currentBehavior.grossKnown) }}</p></Card
          ><Card class="p-5"
            ><p class="text-muted-foreground text-sm">Pending paycheck matches</p>
            <p class="mt-2 text-2xl font-semibold">{{ data.currentBehavior.heldForReconciliation }}</p></Card
          >
        </div>
        <Card class="p-5"
          ><h2 class="mb-4 font-semibold">{{ mode === 'income' ? 'Income over time' : 'Taxes over time' }}</h2>
          <FinanceChart :rows="chartRows" :series="mode === 'income' ? incomeSeries : taxSeries" mode="overlay"
        /></Card>
        <Card v-if="evidence === 'actual'" class="overflow-hidden"
          ><div class="overflow-x-auto">
            <table class="w-full min-w-160 text-sm">
              <thead class="bg-muted">
                <tr>
                  <th class="p-3 text-left">Period start</th>
                  <th class="p-3 text-right">Recorded net</th>
                  <th class="p-3 text-right">Gross</th>
                  <th class="p-3 text-right">Bonus</th>
                  <th class="p-3 text-right">Employer contributions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="point in data.periods" :key="point.date" class="border-border border-t">
                  <td class="p-3">{{ point.date }}</td>
                  <td class="p-3 text-right">{{ money(point.actualNet) }}</td>
                  <td class="p-3 text-right">{{ money(point.gross) }}</td>
                  <td class="p-3 text-right">{{ money(point.bonus) }}</td>
                  <td class="p-3 text-right">{{ money(point.employerContributions) }}</td>
                </tr>
              </tbody>
            </table>
          </div></Card
        >
      </template>
      <template v-if="activeTab === 'allocation'">
        <div class="flex flex-wrap gap-3">
          <label class="text-sm"
            >Saved plan
            <select v-model="selected" :class="field">
              <option v-for="item in data.calculations" :key="item.plan.id" :value="item.plan.id">
                {{ item.plan.name }} ({{ item.plan.evidence }})
              </option>
            </select></label
          ><label class="text-sm"
            >Display period
            <select v-model="period" :class="field">
              <option value="biweekly">Bi-Weekly average</option>
              <option value="monthly">Monthly average</option>
              <option value="yearly">Yearly</option>
            </select></label
          ><Button as-child variant="outline"
            ><router-link to="/finances/taxes">Edit planning inputs</router-link></Button
          >
        </div>
        <Callout v-if="!result"
          >No saved income plan. Add planning inputs under Finances â†’ Taxes. Actual bank records remain available in
          History.</Callout
        >
        <template v-else>
          <p class="text-muted-foreground text-sm">{{ plan?.plan.notes }} {{ result.averages.note }}</p>
          <Callout v-if="!result.available"
            >Tax rules or required inputs are unavailable for this scenario. Missing taxes are not treated as zero, and
            a complete allocation diagram is withheld.</Callout
          >
          <div class="grid gap-4 sm:grid-cols-3">
            <Card class="p-5"
              ><p class="text-muted-foreground text-sm">Total Comp / {{ period }}</p>
              <p class="mt-2 text-2xl font-semibold">{{ money(result.annual.totalComp / divisor) }}</p></Card
            ><Card class="p-5"
              ><p class="text-muted-foreground text-sm">Take Home / {{ period }}</p>
              <p class="mt-2 text-2xl font-semibold">
                {{ money(result.annual.takeHome === null ? null : result.annual.takeHome / divisor) }}
              </p></Card
            ><Card class="p-5"
              ><p class="text-muted-foreground text-sm">Savings, Investments & Retirement</p>
              <p class="mt-2 text-2xl font-semibold">{{ percent(result.savingsInvestmentsRetirementPercent) }}</p>
              <p class="text-muted-foreground mt-1 text-xs">Percentage of Total Compensation</p></Card
            >
          </div>
          <Card v-if="mode === 'income' && result.available && result.flow" class="p-5"
            ><div class="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 class="font-semibold">Income allocation</h2>
              <select v-model="displayMode" aria-label="Flow values" :class="field">
                <option value="percent">Percentages</option>
                <option value="amount">Dollar amounts</option>
                <option value="both">Percentages and dollars</option>
              </select>
            </div>
            <MoneyFlowChart
              :flow="dummy"
              :hierarchy="result.flow"
              :income-display-mode="displayMode"
              :income-period-divisor="divisor"
              :incoming-sources="incoming"
          /></Card>
          <Card v-if="result.available" class="overflow-hidden"
            ><div class="p-5">
              <h2 class="font-semibold">Allocation summary</h2>
              <p class="text-muted-foreground mt-1 text-xs">
                Total Comp is the denominator. Employer contributions increase compensation and Retirement, not Take
                Home.
              </p>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full min-w-160 text-sm">
                <thead class="bg-muted">
                  <tr>
                    <th class="p-3 text-left">Category</th>
                    <th class="p-3 text-right">Percentage</th>
                    <th class="p-3 text-right">Bi-Weekly</th>
                    <th class="p-3 text-right">Monthly</th>
                    <th class="p-3 text-right">Yearly</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in result.allocations" :key="row.id" class="border-border border-t">
                    <td class="p-3">{{ row.label }}</td>
                    <td class="p-3 text-right">{{ percent(row.percent) }}</td>
                    <td class="p-3 text-right">{{ money(row.biweekly) }}</td>
                    <td class="p-3 text-right">{{ money(row.monthly) }}</td>
                    <td class="p-3 text-right">{{ money(row.yearly) }}</td>
                  </tr>
                </tbody>
              </table>
            </div></Card
          >
          <Card class="overflow-hidden"
            ><div class="p-5"><h2 class="font-semibold">Income Breakdown</h2></div>
            <div class="overflow-x-auto">
              <table class="w-full min-w-160 text-sm">
                <thead class="bg-muted text-left">
                  <tr>
                    <th class="p-3">Category</th>
                    <th class="p-3">Field</th>
                    <th class="p-3 text-right">Bi-Weekly</th>
                    <th class="p-3 text-right">Monthly</th>
                    <th class="p-3 text-right">Yearly</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in result.breakdown"
                    :key="row.id"
                    class="border-border border-t"
                    :class="row.subtotal ? 'bg-muted/40 font-semibold' : ''"
                  >
                    <td class="text-muted-foreground p-3">{{ row.group }}</td>
                    <td class="p-3">
                      {{ row.label }}
                      <p v-if="row.note" class="text-muted-foreground text-xs font-normal">{{ row.note }}</p>
                    </td>
                    <td class="p-3 text-right">{{ money(row.biweekly) }}</td>
                    <td class="p-3 text-right">{{ money(row.monthly) }}</td>
                    <td class="p-3 text-right">{{ money(row.yearly) }}</td>
                  </tr>
                </tbody>
              </table>
            </div></Card
          >
          <Card v-if="mode === 'taxes'" class="space-y-3 p-5"
            ><h2 class="font-semibold">Actual withholding versus estimated annual liability</h2>
            <dl class="grid grid-cols-2 gap-3 text-sm">
              <dt>Actual income-tax withholding entered</dt>
              <dd class="text-right">{{ money(result.withholding.actualIncomeTax) }}</dd>
              <dt>Estimated income-tax liability</dt>
              <dd class="text-right">{{ money(result.withholding.estimatedIncomeTax) }}</dd>
              <dt>Projected refund</dt>
              <dd class="text-right">{{ money(result.withholding.projectedRefund) }}</dd>
              <dt>Projected amount owed</dt>
              <dd class="text-right">{{ money(result.withholding.projectedOwed) }}</dd>
              <dt>Federal effective rate</dt>
              <dd class="text-right">{{ percent(result.rates.federalEffective) }}</dd>
              <dt>Federal marginal rate</dt>
              <dd class="text-right">
                {{ percent(result.rates.federalMarginal === null ? null : result.rates.federalMarginal * 100) }}
              </dd>
            </dl>
            <p class="text-muted-foreground text-xs">
              Unknown actual withholding remains unavailable. Ordinary-income estimates are not a complete filed tax
              return.
            </p></Card
          >
          <Callout v-if="result.warnings.length"
            ><ul class="list-disc space-y-1 pl-4">
              <li v-for="warning in result.warnings" :key="warning">{{ warning }}</li>
            </ul></Callout
          >
        </template>
      </template>
      <template v-if="activeTab === 'projections' && mode === 'income'">
        <Card class="space-y-4 p-5"
          ><h2 class="font-semibold">Financial projection assumptions</h2>
          <div class="flex flex-wrap gap-3">
            <select
              v-model="projectionId"
              :class="field"
              aria-label="Saved projection scenario"
              @change="chooseProjection"
            >
              <option value="custom">Custom scenario</option>
              <option v-for="item in data.document.projections" :key="item.id" :value="item.id">
                {{ item.name }}
              </option></select
            ><input v-model="projectionName" :class="field" aria-label="Projection scenario name" /><Button
              variant="outline"
              :disabled="busy || !projectionResult || !projectionName.trim()"
              @click="persistProjection"
              >Save projection inputs</Button
            >
          </div>
          <p v-if="projectionNotes" class="text-muted-foreground text-sm">{{ projectionNotes }}</p>
          <p class="text-muted-foreground text-sm">
            Scenarios are separate from actual account balances. No historical values are overwritten.
          </p>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label
              v-for="[key, label] in [
                ['years', 'Projection duration (years)'],
                ['startingBalance', 'Starting market balance'],
                ['annualContribution', 'Annual contributions'],
                ['annualReturnPercent', 'Expected annual return %'],
                ['salaryGrowthPercent', 'Annual contribution / salary growth %'],
                ['inflationPercent', 'Inflation %'],
              ] as const"
              :key="key"
              class="space-y-1 text-sm"
              >{{ label }}<input v-model.number="projection[key]" type="number" :class="field + ' w-full'" /></label
            ><label class="space-y-1 text-sm"
              >Contribution frequency<select v-model="projection.contributionFrequency" :class="field + ' w-full'">
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
                <option value="annual">Yearly</option>
              </select></label
            >
          </div>
          <div class="flex flex-wrap gap-3">
            <Button variant="outline" :disabled="!result?.available" @click="usePlanContributions"
              >Use selected plan contributions</Button
            ><Button variant="outline" :disabled="!projectionResult" @click="saveComparison"
              >Keep scenario for comparison</Button
            >
          </div></Card
        >
        <Callout v-if="!projectionResult"
          >Check projection inputs. Duration must be 1â€“80 whole years and rates must remain within supported
          bounds.</Callout
        >
        <template v-else
          ><Card class="p-5"><FinanceChart :rows="projectionRows" :series="projectionSeries" mode="overlay" /></Card>
          <div class="grid gap-4 sm:grid-cols-3">
            <Card class="p-5"
              ><p class="text-muted-foreground text-sm">Starting balance + contributions</p>
              <p class="mt-2 text-xl font-semibold">{{ money(finalProjection?.contributions) }}</p></Card
            ><Card class="p-5"
              ><p class="text-muted-foreground text-sm">Projected value</p>
              <p class="mt-2 text-xl font-semibold">{{ money(finalProjection?.value) }}</p></Card
            ><Card class="p-5"
              ><p class="text-muted-foreground text-sm">Growth from assumed returns</p>
              <p class="mt-2 text-xl font-semibold">{{ money(finalProjection?.returns) }}</p></Card
            >
          </div>
          <Callout>{{ projectionResult.warnings.join(' ') }}</Callout></template
        >
        <Card v-if="savedProjectionResults.length" class="space-y-3 p-5"
          ><h2 class="font-semibold">Saved account-group scenarios</h2>
          <div
            v-for="item in savedProjectionResults"
            :key="item.id"
            class="flex flex-wrap justify-between gap-3 text-sm"
          >
            <label class="flex items-start gap-2">
              <input
                v-model="combinedScenarioIds"
                type="checkbox"
                :value="item.id"
                :aria-label="'Include ' + item.name + ' in combined wealth'"
              />
              <span
                >{{ item.name }} · {{ item.input.years }} years · {{ percent(item.input.annualReturnPercent) }} assumed
                return</span
              > </label
            ><span>{{ money(item.result?.value) }}</span>
          </div>
          <div v-if="combinedProjection" class="border-border flex justify-between border-t pt-3 font-semibold">
            <span>Combined accumulated wealth · {{ combinedProjection.years }} years</span
            ><span>{{ money(combinedProjection.value) }}</span>
          </div>
          <p class="text-muted-foreground text-xs">
            Select separate, non-overlapping account groups to combine. Alternative scenarios should remain unselected.
            Selected horizons must match. Starting balances are planning assumptions, not live account valuations.
          </p></Card
        ><Card v-if="comparison.length" class="overflow-hidden"
          ><div class="p-5"><h2 class="font-semibold">Scenario comparison</h2></div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-muted">
                <tr>
                  <th class="p-3 text-left">Scenario</th>
                  <th class="p-3 text-right">Years</th>
                  <th class="p-3 text-right">Return</th>
                  <th class="p-3 text-right">Projected value</th>
                  <th class="p-3 text-right">Inflation-adjusted value</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="scenario in comparison" :key="scenario.name" class="border-border border-t">
                  <td class="p-3">{{ scenario.name }}</td>
                  <td class="p-3 text-right">{{ scenario.input.years }}</td>
                  <td class="p-3 text-right">{{ percent(scenario.input.annualReturnPercent) }}</td>
                  <td class="p-3 text-right">
                    {{
                      money(
                        projectWealth(scenario.input)
                          .scenarios.find((s) => s.frequency === scenario.input.contributionFrequency)
                          ?.points.at(-1)?.value,
                      )
                    }}
                  </td>
                  <td class="p-3 text-right">
                    {{
                      money(
                        projectWealth(scenario.input)
                          .scenarios.find((s) => s.frequency === scenario.input.contributionFrequency)
                          ?.points.at(-1)?.realValue,
                      )
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div></Card
        >
      </template>
    </template>
  </div>
</template>
