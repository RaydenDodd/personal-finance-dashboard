<script setup lang="ts">
import { getIncomeDashboard } from '@/api/income-management';
import PageWrapper from '@/components/common/page-wrapper.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { calculateIncomePlan } from '@bt/shared/finance-income';
import type { IncomeDashboard } from '@bt/shared/types/income-management';
import { computed, onMounted, ref, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { ROUTES_NAMES } from '@/routes';
import ProjectedSummary from './payroll/projected-summary.vue';
import { useLocalStorage } from '@vueuse/core';
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
  error = ref('');
const router = useRouter();
function editProjections(section?: string) {
  void router.push({
    name: ROUTES_NAMES.projectedIncomeEdit,
    query: { ...(current.value ? { plan: current.value.id } : {}), ...(section ? { section } : {}) },
  });
}
const period = useLocalStorage<'monthly' | 'yearly' | 'biweekly'>('income:projected:period', 'yearly');
const divisor = computed(() => (period.value === 'monthly' ? 12 : period.value === 'biweekly' ? 26 : 1));
const periodLabel = computed(() =>
  period.value === 'yearly' ? 'Yearly' : period.value === 'monthly' ? 'Monthly' : 'Biweekly',
);
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
            @edit="editProjections()"
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
        <Button variant="outline" @click="editProjections('retirement')">Edit contributions and taxes</Button>
      </div>
    </div>
  </PageWrapper>
</template>
