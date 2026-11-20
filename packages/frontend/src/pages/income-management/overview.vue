<script setup lang="ts">
import { getIncomeDashboard, saveIncomeDocument } from '@/api/income-management';
import PageWrapper from '@/components/common/page-wrapper.vue';
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { Callout } from '@/components/lib/ui/callout';
import { Dialog, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/lib/ui/dialog';
import FinanceChart, { type ChartRow } from '@/pages/personal-finance/finance-chart.vue';
import { calculateIncomePlan, createDefaultIncomePlan } from '@bt/shared/finance-income';
import type { IncomeDashboard, IncomePlanVersion } from '@bt/shared/types/income-management';
import { computed, onMounted, ref, watch, nextTick } from 'vue';
import IncomeSettings from './taxes.vue';
import PaycheckManager from './index.vue';
import PeriodButtons from './period-buttons.vue';
import IncomeAllocationView from './income-allocation.vue';
import { incomeAllocation } from './income-allocation';
import DashboardPageLayout from '@/pages/dashboard/components/dashboard-page-layout.vue';
import { pageBlock, defaultPageLayout } from '@/pages/dashboard/composables/page-blocks';
const pageLayout = ref<InstanceType<typeof DashboardPageLayout> | null>(null);
const breakdown = ref<InstanceType<typeof IncomeAllocationView> | null>(null);
const allocationView = ref<'donut' | 'flow'>('donut');
const blocks = Object.fromEntries(
  [
    pageBlock('summary', 'Income summary', 'Income, retirement, taxes, savings and spendable money.'),
    pageBlock('salary-history', 'Salary history', 'Your recorded salary changes over time.'),
    pageBlock('allocation', 'Income allocation', 'Doughnut and flow diagram.'),
    pageBlock('breakdown', 'Income breakdown', 'Expandable taxes and contribution details.'),
  ].map((b) => [b.id, b]),
);
const defaultLayout = defaultPageLayout(blocks);
async function selectIncomeGroup(id: string) {
  pageLayout.value?.revealWidget('breakdown');
  await nextTick();
  breakdown.value?.openGroup(id);
}
const data = ref<IncomeDashboard | null>(null),
  error = ref(''),
  busy = ref(false);
const salaryOpen = ref(false),
  settingsOpen = ref(false),
  paychecksOpen = ref(false);
const salary = ref(0),
  bonus = ref(0),
  since = ref(''),
  until = ref(''),
  historical = ref(false);
const period = ref<'monthly' | 'yearly' | 'biweekly'>('yearly');
const divisor = computed(() => (period.value === 'monthly' ? 12 : period.value === 'biweekly' ? 26 : 1));
const periodLabel = computed(() =>
  period.value === 'yearly' ? 'Yearly' : period.value === 'monthly' ? 'Monthly' : 'Biweekly',
);
const field = 'border-input bg-background h-11 w-full rounded-md border px-3 text-sm';
const money = (n: number | null | undefined) =>
  n == null ? 'Unavailable' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
const current = computed(() => {
  const plans = data.value?.document.plans ?? [],
    today = new Date().toLocaleDateString('en-CA');
  return [...plans]
    .filter(
      (p) =>
        p.evidence !== 'projected' &&
        (!p.effectiveFrom || p.effectiveFrom <= today) &&
        (!p.effectiveTo || p.effectiveTo >= today),
    )
    .sort((a, b) => (a.effectiveFrom ?? '').localeCompare(b.effectiveFrom ?? ''))
    .at(-1);
});
const result = computed(() => (current.value ? calculateIncomePlan(current.value.input) : null));
const allocation = computed(() => (result.value ? incomeAllocation(result.value, divisor.value) : null));
const salaryRows = computed<ChartRow[]>(() => {
  const versions = [...(data.value?.document.plans ?? [])]
    .filter((p) => p.evidence !== 'projected' && p.effectiveFrom)
    .sort((a, b) => a.effectiveFrom!.localeCompare(b.effectiveFrom!));
  const byDate = new Map(
    versions.map((p) => [
      p.effectiveFrom!,
      { label: p.effectiveFrom!, values: { income: p.input.annualSalary + p.input.annualBonus } },
    ]),
  );
  if (!byDate.size && current.value)
    return [
      {
        label: 'Current salary',
        values: { income: current.value.input.annualSalary + current.value.input.annualBonus },
      },
    ];
  return [...byDate.values()];
});
async function load() {
  try {
    data.value = await getIncomeDashboard('1900-01-01', new Date().toISOString().slice(0, 10));
  } catch {
    error.value = 'Income could not be loaded. Please try again.';
  }
}
function editSalary(past = false) {
  historical.value = past;
  salary.value = current.value?.input.annualSalary ?? 0;
  bonus.value = current.value?.input.annualBonus ?? 0;
  since.value = past ? '' : new Date().toLocaleDateString('en-CA');
  until.value = '';
  salaryOpen.value = true;
}
async function saveSalary() {
  if (
    !data.value ||
    !Number.isFinite(salary.value) ||
    salary.value < 0 ||
    !Number.isFinite(bonus.value) ||
    bonus.value < 0 ||
    !since.value ||
    (historical.value &&
      (!until.value || until.value < since.value || until.value >= new Date().toLocaleDateString('en-CA')))
  )
    return;
  busy.value = true;
  error.value = '';
  try {
    const plan: IncomePlanVersion = {
      id: crypto.randomUUID(),
      employerId: current.value?.employerId ?? null,
      name: historical.value ? 'Previous salary' : 'Yearly salary',
      effectiveFrom: since.value,
      effectiveTo: historical.value ? until.value : null,
      evidence: 'estimated',
      input: {
        ...(current.value?.input ?? createDefaultIncomePlan()),
        taxYear: Number(since.value.slice(0, 4)),
        annualSalary: salary.value,
        annualBonus: bonus.value,
      },
      notes: 'Salary entered directly in Income.',
    };
    const plans = JSON.parse(JSON.stringify(data.value.document.plans)) as IncomePlanVersion[];
    const next = plans
      .filter((p) => p.effectiveFrom && p.effectiveFrom > since.value && p.evidence !== 'projected')
      .sort((a, b) => a.effectiveFrom!.localeCompare(b.effectiveFrom!))[0];
    if (next?.effectiveFrom && !plan.effectiveTo) {
      const date = new Date(next.effectiveFrom + 'T12:00:00Z');
      date.setUTCDate(date.getUTCDate() - 1);
      plan.effectiveTo = date.toISOString().slice(0, 10);
    }
    plans.push(plan);
    await saveIncomeDocument({ ...data.value.document, plans });
    salaryOpen.value = false;
    await load();
  } catch {
    error.value = 'Salary was not saved. Reload and try again.';
  } finally {
    busy.value = false;
  }
}
watch(settingsOpen, (open, old) => {
  if (!open && old) void load();
});
watch(paychecksOpen, (open, old) => {
  if (!open && old) void load();
});
onMounted(load);
</script>
<template>
  <PageWrapper
    ><div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-2xl font-semibold">Income</h1>
        <div class="flex flex-wrap items-center gap-3">
          <PeriodButtons v-model="period" /><Button variant="outline" @click="paychecksOpen = true">Paychecks</Button>
        </div>
      </header>
      <Callout v-if="error" variant="destructive">{{ error }}</Callout>
      <DashboardPageLayout ref="pageLayout" page="income" :registry="blocks" :default-layout="defaultLayout">
        <template #summary>
          <Card class="@container p-5 sm:p-7" data-testid="income-summary">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p class="text-muted-foreground text-sm">{{ periodLabel }} income</p>
                <p class="mt-2 text-4xl font-semibold tracking-tight">
                  {{ money(result ? result.annual.totalComp / divisor : null) }}
                </p>
                <p v-if="result" class="text-muted-foreground mt-2 text-xs">
                  Gross income {{ money(result.annual.gross / divisor)
                  }}<template v-if="result.annual.employerMatch">
                    + Employer 401(k) match {{ money(result.annual.employerMatch / divisor) }}</template
                  ><template v-if="result.annual.employerOtherContribution">
                    + Other employer retirement {{ money(result.annual.employerOtherContribution / divisor) }}</template
                  >
                </p>
              </div>
              <Button @click="editSalary()">Edit salary</Button>
            </div>
            <div
              class="divide-border/60 border-border/60 mt-6 grid divide-y border-t @2xl:grid-cols-2 @2xl:divide-x @2xl:divide-y-0 @4xl:grid-cols-4"
            >
              <div v-for="item in allocation?.groups" :key="item.id" class="py-4 @2xl:px-4 @2xl:first:pl-0">
                <p class="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
                  <span class="size-2 rounded-sm" :style="{ background: item.color }" />{{ item.name }}
                </p>
                <p class="mt-2 flex flex-wrap items-baseline gap-x-2 text-xl font-semibold tabular-nums">
                  {{ money(item.amount)
                  }}<span v-if="allocation?.flow.income" class="text-muted-foreground text-xs font-medium"
                    >{{ ((item.amount / allocation.flow.income) * 100).toFixed(1) }}%</span
                  >
                </p>
              </div>
            </div>
          </Card> </template
        ><template #salary-history>
          <Card class="p-5 sm:p-6"
            ><div class="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 class="text-lg font-semibold">Salary history</h2>
              <div class="flex flex-wrap gap-2">
                <Button as-child size="sm" variant="ghost"
                  ><router-link to="/finances/income/history">Received income</router-link></Button
                ><Button size="sm" variant="outline" @click="editSalary(true)">Add earlier salary</Button>
              </div>
            </div>
            <FinanceChart
              :rows="salaryRows"
              :series="[
                {
                  id: 'income',
                  name: 'Yearly salary',
                  color: '#7b65c1',
                },
              ]"
              mode="line"
            />
            <p
              v-if="salaryRows.length === 1 && salaryRows[0]?.label === 'Current salary'"
              class="text-muted-foreground mt-3 text-xs"
            >
              Add earlier salaries to see changes over time.
            </p></Card
          > </template
        ><template #allocation
          ><IncomeAllocationView
            v-if="result"
            v-model:view="allocationView"
            :result="result"
            :input="current!.input"
            :divisor="divisor"
            :period-label="periodLabel"
            part="chart"
            @select="selectIncomeGroup"
        /></template>
        <template #breakdown
          ><IncomeAllocationView
            v-if="result"
            ref="breakdown"
            :result="result"
            :input="current!.input"
            :divisor="divisor"
            :period-label="periodLabel"
            part="breakdown"
        /></template>
      </DashboardPageLayout>
      <div class="flex justify-end">
        <Button variant="outline" @click="settingsOpen = true">Edit contributions and taxes</Button>
      </div>
      <Dialog v-model:open="salaryOpen"
        ><DialogScrollContent class="max-w-md"
          ><DialogHeader
            ><DialogTitle>{{ historical ? 'Add earlier salary' : 'Your yearly salary' }}</DialogTitle
            ><DialogDescription
              >Enter gross yearly pay. Contributions and take-home calculations update from this
              amount.</DialogDescription
            ></DialogHeader
          >
          <form class="space-y-4" @submit.prevent="saveSalary">
            <label class="block space-y-1 text-sm"
              >Yearly salary<input
                v-model.number="salary"
                type="number"
                min="0"
                step="0.01"
                required
                :class="field" /></label
            ><label class="block space-y-1 text-sm"
              >Yearly bonus<input
                v-model.number="bonus"
                type="number"
                min="0"
                step="0.01"
                required
                :class="field" /></label
            ><label class="block space-y-1 text-sm"
              >Starting date<input v-model="since" type="date" required :class="field" /></label
            ><label v-if="historical" class="block space-y-1 text-sm"
              >Through date<input
                v-model="until"
                type="date"
                required
                :max="new Date(Date.now() - 86400000).toLocaleDateString('en-CA')"
                :class="field" /></label
            ><Button type="submit" :disabled="busy">Save salary</Button>
          </form></DialogScrollContent
        ></Dialog
      >
      <Dialog v-model:open="settingsOpen"
        ><DialogScrollContent class="max-w-5xl"
          ><DialogHeader
            ><DialogTitle>Contributions and tax settings</DialogTitle
            ><DialogDescription
              >Adjust retirement, savings and deductions. Your saved salary is already filled in.</DialogDescription
            ></DialogHeader
          ><IncomeSettings
            v-if="settingsOpen"
            @saved="settingsOpen = false"
            @cancel="settingsOpen = false" /></DialogScrollContent
      ></Dialog>
      <Dialog v-model:open="paychecksOpen"
        ><DialogScrollContent class="max-w-5xl"
          ><DialogHeader
            ><DialogTitle>Paychecks and connected income</DialogTitle
            ><DialogDescription
              >Review deposits or import individual paychecks when you need more detail.</DialogDescription
            ></DialogHeader
          ><PaycheckManager v-if="paychecksOpen" /></DialogScrollContent
      ></Dialog></div
  ></PageWrapper>
</template>
