<script setup lang="ts">
import { getIncomeDashboard, saveIncomeDocument } from '@/api/income-management';
import { Card } from '@/components/lib/ui/card';
import { Callout } from '@/components/lib/ui/callout';
import { Button } from '@/components/lib/ui/button';
import FinanceChart, { type ChartRow, type ChartSeries } from '@/pages/personal-finance/finance-chart.vue';
import { projectWealth, type IncomePlanResult, type WealthProjectionInput } from '@bt/shared/finance-income';
import type { IncomeDashboard } from '@bt/shared/types/income-management';
import { computed, onMounted, ref, watch } from 'vue';

import PeriodButtons from './period-buttons.vue';
import { useRoute } from 'vue-router';
import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue';
const route = useRoute();
const data = ref<IncomeDashboard | null>(null),
  error = ref(''),
  busy = ref(false),
  year = ref(new Date().getFullYear());
const selected = ref(''),
  period = ref<'biweekly' | 'monthly' | 'yearly'>('monthly');
const activeTab = ref<'history' | 'taxes' | 'projections'>(route.query.view === 'taxes' ? 'taxes' : 'history');
const historyPeriod = period;
const plan = computed(() => data.value?.calculations.find((item) => item.plan.id === selected.value) ?? null);
const result = computed<IncomePlanResult | null>(() => plan.value?.result ?? null);
const field = 'border-input bg-background h-10 min-w-0 max-w-full rounded-md border px-3 text-sm';
const money = (n: number | null | undefined) =>
  n == null ? 'Unavailable' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
const percent = (n: number | null | undefined) => (n == null ? 'Unavailable' : n.toFixed(2) + '%');
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
const chartRows = computed<ChartRow[]>(
  () =>
    data.value?.periods.map(
      (p): ChartRow => ({
        label: p.date,
        values:
          activeTab.value === 'taxes'
            ? {
                federal: p.federal,
                state: p.state,
                local: p.local,
                socialSecurity: p.socialSecurity,
                medicare: p.medicare,
              }
            : {
                gross: p.gross,
                net: p.actualNet,
                bonus: p.bonus,
                comp: p.gross === null || p.employerContributions === null ? null : p.gross + p.employerContributions,
                spendable: null,
              },
      }),
    ) ?? [],
);
const visibleSeries = computed(() =>
  (activeTab.value === 'taxes' ? taxSeries : incomeSeries).filter((s) =>
    chartRows.value.some((r) => r.values[s.id] != null),
  ),
);
const received = computed(() => data.value?.periods.reduce((sum, p) => sum + (p.actualNet ?? 0), 0) ?? 0);
const hasGross = computed(() => data.value?.periods.some((p) => p.gross != null));
const hasBonus = computed(() => data.value?.periods.some((p) => p.bonus != null));
const hasEmployer = computed(() => data.value?.periods.some((p) => p.employerContributions != null));
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
let reportRequest = 0;
async function load() {
  const request = ++reportRequest;
  busy.value = true;
  error.value = '';
  try {
    const response = await getIncomeDashboard(`${year.value}-01-01`, `${year.value}-12-31`, historyPeriod.value);
    if (request !== reportRequest) return;
    data.value = response;
    selected.value ||= data.value.calculations.at(-1)?.plan.id ?? '';
  } catch {
    error.value = 'Income reports could not be loaded. Stored financial records were not changed.';
  } finally {
    if (request === reportRequest) busy.value = false;
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
async function shiftYear(delta: number) {
  year.value = Math.max(1900, Math.min(2200, year.value + delta));
  await load();
}
const projectionPeriod = computed<'biweekly' | 'monthly' | 'yearly'>({
  get: () => (projection.value.contributionFrequency === 'annual' ? 'yearly' : projection.value.contributionFrequency),
  set: (v) => {
    projection.value.contributionFrequency = v === 'yearly' ? 'annual' : v;
  },
});
watch(period, () => {
  void load();
});
onMounted(load);
</script>
<template>
  <div class="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Income reports</h1>
      </div>
      <div v-if="activeTab !== 'projections'" class="flex items-center gap-2" aria-label="Report year">
        <Button variant="ghost" aria-label="Previous year" :disabled="busy || year <= 1900" @click="shiftYear(-1)"
          ><ChevronLeftIcon class="size-4" /></Button
        ><span class="min-w-16 text-center font-semibold" data-testid="report-year">{{ year }}</span
        ><Button variant="ghost" aria-label="Next year" :disabled="busy || year >= 2200" @click="shiftYear(1)"
          ><ChevronRightIcon class="size-4"
        /></Button>
      </div>
    </div>
    <Callout v-if="error" variant="destructive">{{ error }}</Callout>
    <div class="flex flex-wrap gap-2">
      <Button :variant="activeTab === 'history' ? 'default' : 'outline'" @click="activeTab = 'history'"
        >Received income</Button
      >
      <Button :variant="activeTab === 'taxes' ? 'default' : 'outline'" @click="activeTab = 'taxes'">Taxes</Button>
      <Button :variant="activeTab === 'projections' ? 'default' : 'outline'" @click="activeTab = 'projections'"
        >Financial projections</Button
      >
    </div>
    <template v-if="data">
      <template v-if="activeTab !== 'projections'">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <PeriodButtons v-model="period" /><Button as-child variant="ghost" size="sm"
            ><router-link to="/finances/income">Manage income</router-link></Button
          >
        </div>
        <Card class="p-5" v-if="activeTab === 'history'"
          ><p class="text-muted-foreground text-sm">Received in {{ year }}</p>
          <p class="mt-2 text-3xl font-semibold">{{ money(received) }}</p></Card
        >
        <Card class="p-5">
          <h2 class="mb-4 font-semibold">
            {{ activeTab === 'taxes' ? 'Recorded taxes' : 'Received income over time' }}
          </h2>
          <FinanceChart v-if="visibleSeries.length" :rows="chartRows" :series="visibleSeries" mode="overlay" />
          <p v-else class="text-muted-foreground py-8 text-center text-sm">
            {{
              activeTab === 'taxes'
                ? 'No payroll tax details recorded for this year. Add a paystub to track withholding.'
                : 'No recorded income for this year.'
            }}
          </p>
        </Card>
        <Card v-if="activeTab === 'history' && data.periods.length" class="overflow-hidden"
          ><div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-muted">
                <tr>
                  <th class="p-3 text-left">Period</th>
                  <th class="p-3 text-right">Received</th>
                  <th v-if="hasGross" class="p-3 text-right">Gross</th>
                  <th v-if="hasBonus" class="p-3 text-right">Bonus</th>
                  <th v-if="hasEmployer" class="p-3 text-right">Employer contributions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="point in data.periods" :key="point.date" class="border-border/50 border-t">
                  <td class="p-3">{{ point.date }}</td>
                  <td class="p-3 text-right tabular-nums">{{ money(point.actualNet) }}</td>
                  <td v-if="hasGross" class="p-3 text-right tabular-nums">{{ money(point.gross) }}</td>
                  <td v-if="hasBonus" class="p-3 text-right tabular-nums">{{ money(point.bonus) }}</td>
                  <td v-if="hasEmployer" class="p-3 text-right tabular-nums">
                    {{ money(point.employerContributions) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div></Card
        >
      </template>
      <template v-if="activeTab === 'projections'">
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
              >{{ label }}<input v-model.number="projection[key]" type="number" :class="field + ' w-full'"
            /></label>
            <div class="space-y-2 text-sm">
              <span>Contribution frequency</span><PeriodButtons v-model="projectionPeriod" />
            </div>
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
