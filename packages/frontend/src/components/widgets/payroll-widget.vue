<script setup lang="ts">
import { useDashboardPeriod } from './composables/use-dashboard-period';
import {
  differenceInCalendarDays,
  differenceInCalendarMonths,
  endOfMonth,
  isSameDay,
  parseISO,
  startOfMonth,
} from 'date-fns';
import { getPayroll } from '@/api/payroll';
import { getIncomeDashboard } from '@/api/income-management';
import type { DashboardWidgetConfig } from '@/api/user-settings';
import { Button } from '@/components/lib/ui/button';
import PayrollWidgetActions from './payroll-widget-actions.vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, inject, provide, type Ref } from 'vue';
import { useRouter } from 'vue-router';
import { calculateIncomePlan } from '@bt/shared/finance-income';
import ActualSummary from '@/pages/income-management/payroll/actual-summary.vue';
import SalaryHistory from '@/pages/income-management/payroll/salary-history.vue';
import ReceivedIncome from '@/pages/income-management/payroll/received-income.vue';
import DetailSummary from '@/pages/income-management/payroll/detail-summary.vue';
import ProjectedSummary from '@/pages/income-management/payroll/projected-summary.vue';
import IncomeAllocationView from '@/pages/income-management/income-allocation.vue';
import { incomeAllocation } from '@/pages/income-management/income-allocation';
import LoadingState from './components/loading-state.vue';
import ErrorState from './components/error-state.vue';

const { dashboardRange } = useDashboardPeriod();
const config = inject<Ref<DashboardWidgetConfig>>('dashboard-widget-config')!;
const router = useRouter();
const id = computed(() => config.value.widgetId);
provide(
  'income-chart-height',
  computed(() => 312 + Math.max(0, (config.value.rowSpan ?? 1) - 1) * 400),
);
const key = computed(() => 'dashboard-payroll-' + (config.value.instanceId ?? id.value));
const projected = computed(() => id.value.startsWith('projected-income'));
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const year = computed(() => {
  const current = Number(today().slice(0, 4));
  return config.value.config?.year === 'previous' ? current - 1 : current;
});
const from = computed(() => dashboardRange.value?.from ?? year.value + '-01-01');
const through = computed(
  () => dashboardRange.value?.through ?? (year.value < Number(today().slice(0, 4)) ? year.value + '-12-31' : today()),
);
const { data, isPending, isError, refetch } = useQuery({
  queryKey: computed(() => ['actual-payroll', { from: from.value, through: through.value }]),
  queryFn: () => getPayroll({ from: from.value, through: through.value }),
  enabled: computed(() => !projected.value),
});
const {
  data: plans,
  isPending: planPending,
  isError: planError,
  refetch: reloadPlans,
} = useQuery({
  queryKey: ['income', 'projected-widget'],
  queryFn: () => getIncomeDashboard(),
  enabled: projected,
});
const plan = computed(() =>
  [...(plans.value?.document.plans ?? [])]
    .filter(
      (p) =>
        p.evidence !== 'projected' &&
        (!p.effectiveFrom || p.effectiveFrom <= through.value) &&
        (!p.effectiveTo || p.effectiveTo >= from.value),
    )
    .sort((a, b) => (a.effectiveFrom ?? '').localeCompare(b.effectiveFrom ?? ''))
    .at(-1),
);
const result = computed(() => (plan.value ? calculateIncomePlan(plan.value.input) : null));
const period = computed(() => String(config.value.config?.period ?? 'yearly'));
const divisor = computed(() => {
  if (dashboardRange.value) {
    const start = parseISO(from.value),
      end = parseISO(through.value);
    if (isSameDay(start, startOfMonth(start)) && isSameDay(end, endOfMonth(end)))
      return 12 / (differenceInCalendarMonths(end, start) + 1);
    return 365 / (differenceInCalendarDays(end, start) + 1);
  }
  return period.value === 'monthly' ? 12 : period.value === 'biweekly' ? 26 : 1;
});
const periodLabel = computed(() =>
  dashboardRange.value
    ? ''
    : period.value === 'monthly'
      ? 'Monthly'
      : period.value === 'biweekly'
        ? 'Biweekly'
        : 'Yearly',
);
const allocation = computed(() => (result.value ? incomeAllocation(result.value, divisor.value) : null));
const detail = computed(
  () =>
    (({
      'payroll-growth': 'growth',
      'payroll-bonuses': 'bonuses',
      'payroll-retirement': 'retirement',
      'payroll-taxes': 'taxes',
    })[id.value] ?? 'growth') as 'growth' | 'bonuses' | 'retirement' | 'taxes',
);
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-col md:h-full" :data-payroll-widget="id">
    <div class="min-h-0 flex-1">
      <template v-if="projected">
        <LoadingState v-if="planPending" />
        <ErrorState v-else-if="planError" message="Projected income could not be loaded." @retry="reloadPlans()" />
        <template v-else-if="result && plan">
          <ProjectedSummary
            v-if="id === 'projected-income-summary'"
            :result="result"
            :allocation="allocation"
            :divisor="divisor"
            :period-label="periodLabel"
            @edit="router.push({ path: '/finances/income/projected/edit', query: { plan: plan.id } })"
            ><template #action><PayrollWidgetActions projected /></template
          ></ProjectedSummary>
          <IncomeAllocationView
            v-else
            :result="result"
            :input="plan.input"
            :divisor="divisor"
            :period-label="periodLabel"
            part="chart"
            :view="config.config?.view === 'flow' ? 'flow' : 'donut'"
            ><template #action><PayrollWidgetActions projected :settings="false" /></template
          ></IncomeAllocationView>
        </template>
        <div v-else class="bg-card rounded-xl border p-5 text-sm">
          Set up your projected income first.<Button as-child variant="link"
            ><router-link to="/finances/income/projected">Projection settings</router-link></Button
          >
        </div>
      </template>
      <template v-else>
        <LoadingState v-if="isPending" />
        <ErrorState v-else-if="isError" message="Actual payroll could not be loaded." @retry="refetch()" />
        <template v-else-if="data">
          <ActualSummary v-if="id === 'payroll-summary'" :data="data" :from="from" :through="through"
            ><template #action><PayrollWidgetActions /></template
          ></ActualSummary>
          <SalaryHistory
            v-else-if="['payroll-salary-history', 'payroll-growth'].includes(id)"
            :title="id === 'payroll-growth' ? 'Salary growth' : 'Salary history'"
            :settings-key="key"
            :data="data"
            ><template #action><PayrollWidgetActions :settings="false" /></template
          ></SalaryHistory>
          <ReceivedIncome v-else-if="id === 'payroll-received-income'" :settings-key="key" :data="data"
            ><template #action><PayrollWidgetActions :settings="false" /></template
          ></ReceivedIncome>
          <DetailSummary v-else :data="data" :kind="detail" :from="from" :through="through"
            ><template #action><PayrollWidgetActions /></template
          ></DetailSummary>
        </template>
      </template>
    </div>
  </div>
</template>
