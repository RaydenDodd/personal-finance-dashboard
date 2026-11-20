<script setup lang="ts">
import { getIncomeDashboard, saveIncomeDocument } from '@/api/income-management';
import PageWrapper from '@/components/common/page-wrapper.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Dialog, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/lib/ui/dialog';
import { calculateIncomePlan, createDefaultIncomePlan } from '@bt/shared/finance-income';
import type { IncomeDashboard, IncomePlanVersion } from '@bt/shared/types/income-management';
import { computed, onMounted, ref, watch, nextTick } from 'vue';
import IncomeSettings from './taxes.vue';
import ProjectedSummary from './payroll/projected-summary.vue';
import { useLocalStorage } from '@vueuse/core';
import { usePayroll } from './payroll/use-payroll';
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
  settingsOpen = ref(false);
const payroll = usePayroll();
const latestPayroll = computed(() =>
  [...(payroll.data.value?.statements ?? [])]
    .filter((s) => s.regularRate !== null && !s.adjustment && s.totals.regular > 0)
    .at(-1),
);
const salary = ref(0),
  bonus = ref(0),
  since = ref(''),
  until = ref(''),
  historical = ref(false);
const period = useLocalStorage<'monthly' | 'yearly' | 'biweekly'>('income:projected:period', 'yearly');
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
    .filter((p) => (!p.effectiveFrom || p.effectiveFrom <= today) && (!p.effectiveTo || p.effectiveTo >= today))
    .sort((a, b) => (a.effectiveFrom ?? '').localeCompare(b.effectiveFrom ?? ''))
    .at(-1);
});
const result = computed(() => (current.value ? calculateIncomePlan(current.value.input) : null));
const allocation = computed(() => (result.value ? incomeAllocation(result.value, divisor.value) : null));
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
      notes: 'Projected salary entered directly in Projected Income.',
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
onMounted(load);
</script>
<template>
  <PageWrapper
    ><div class="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-2xl font-semibold">Projected Income</h1>
        <div class="flex flex-wrap items-center gap-3">
          <PeriodButtons v-model="period" />
        </div>
      </header>
      <Callout v-if="error" variant="destructive">{{ error }}</Callout>
      <DashboardPageLayout ref="pageLayout" page="income" :registry="blocks" :default-layout="defaultLayout">
        <template #summary>
          <ProjectedSummary
            :result="result"
            :allocation="allocation"
            :divisor="divisor"
            :period-label="periodLabel"
            @edit="editSalary()"
          />
        </template>
        <template #allocation
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
            ><DialogTitle>{{ historical ? 'Add earlier salary' : 'Projected yearly salary' }}</DialogTitle
            ><DialogDescription
              >Enter gross yearly pay. Contributions and take-home calculations update from this
              amount.</DialogDescription
            ></DialogHeader
          >
          <div
            v-if="payroll.data.value?.summary.currentSalary"
            class="bg-muted/50 mb-4 space-y-2 rounded-md border p-3 text-xs"
          >
            <p>
              Latest payroll base rate: <b>{{ money(payroll.data.value.summary.currentSalary) }}</b
              >. Your saved projection stays unchanged until you apply it.
            </p>
            <p v-if="latestPayroll" class="text-muted-foreground">
              Latest observed employee retirement: {{ money(latestPayroll.totals.employeeRetirement) }}; employer
              retirement: {{ money(latestPayroll.totals.employerRetirement) }}. One paycheck does not establish a future
              contribution election or matching rule.
            </p>
            <Button size="sm" variant="outline" @click="salary = payroll.data.value!.summary.currentSalary!"
              >Use latest payroll salary</Button
            >
          </div>
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
            ><Button type="submit" :disabled="busy">Save changes</Button>
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
    </div>
  </PageWrapper>
</template>
