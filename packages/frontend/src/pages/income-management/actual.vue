<script setup lang="ts">
import PageWrapper from '@/components/common/page-wrapper.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/common/dropdown-menu';
import {
  ChevronDownIcon,
  RefreshCwIcon,
  FileInputIcon,
  BriefcaseIcon,
  HistoryIcon,
  SettingsIcon,
  BanknoteIcon,
  TrendingUpIcon,
} from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useLocalStorage } from '@vueuse/core';
import DashboardPageLayout from '@/pages/dashboard/components/dashboard-page-layout.vue';
import DashboardEditToolbar from '@/pages/dashboard/components/dashboard-edit-toolbar.vue';
import { pageBlock, defaultPageLayout } from '@/pages/dashboard/composables/page-blocks';
import DateRange from './payroll/date-range.vue';
import { payrollRange, type PayrollRange } from './payroll/date-range';
import { usePayroll } from './payroll/use-payroll';
import ActualSummary from './payroll/actual-summary.vue';
import SalaryHistory from './payroll/salary-history.vue';
import ReceivedIncome from './payroll/received-income.vue';
import PayrollManagement, { type PayrollManagementSection } from './payroll/management.vue';
const route = useRoute(),
  router = useRouter();
const savedRange = useLocalStorage<PayrollRange>('payroll:actual:range', payrollRange('ytd'));
const range = ref(savedRange.value.preset === 'custom' ? savedRange.value : payrollRange(savedRange.value.preset));
watch(
  range,
  (value) => {
    savedRange.value = value;
  },
  { deep: true },
);
const employmentId = useLocalStorage('payroll:actual:employment', 'all');
const query = usePayroll(() => ({
  from: range.value.from,
  through: range.value.through,
  employmentId: employmentId.value === 'all' ? undefined : employmentId.value,
}));
const data = computed(() => query.data.value),
  management = ref<PayrollManagementSection | null>(null);
watch(
  () => data.value?.summary.coverageFrom,
  (value) => {
    if (value && range.value.preset === 'all' && range.value.from !== value)
      range.value = { ...range.value, from: value };
  },
);
const blocks = Object.fromEntries(
  [
    pageBlock('actual-summary', 'Actual income and compensation', 'Current base salary and actual payroll totals.'),
    pageBlock('salary-history', 'Salary history', 'Recorded base salary changes and employment history.'),
    pageBlock('received-income', 'Received income', 'Payroll allocations as stacked bars with gross earnings.'),
  ].map((b) => [b.id, b]),
);
const defaultLayout = defaultPageLayout(blocks);
watch(
  () => route.query.manage,
  (value) => {
    if (
      value === 'sync' ||
      value === 'paychecks' ||
      value === 'employment' ||
      value === 'salary' ||
      value === 'settings' ||
      value === 'history' ||
      value === 'retirement' ||
      value === 'import'
    ) {
      management.value = value;
      void router.replace({ query: { ...route.query, manage: undefined } });
    }
  },
  { immediate: true },
);
const menus = [
  { id: 'sync', name: 'Sync ADP payroll', icon: RefreshCwIcon },
  { id: 'import', name: 'Import payroll files', icon: FileInputIcon },
  { id: 'paychecks', name: 'View paychecks', icon: BanknoteIcon },
  { id: 'employment', name: 'Manage employment history', icon: BriefcaseIcon },
  { id: 'salary', name: 'Manage salary history', icon: TrendingUpIcon },
  { id: 'retirement', name: 'Reconcile retirement contributions', icon: BanknoteIcon },
  { id: 'settings', name: 'Payroll settings', icon: SettingsIcon },
  { id: 'history', name: 'Sync and import history', icon: HistoryIcon },
] as const;
</script>
<template>
  <PageWrapper
    ><div class="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6" data-testid="actual-income-page">
      <Callout v-if="query.isError.value" variant="destructive"
        >Actual payroll could not be loaded.
        <button class="underline" @click="query.refetch()">Try again</button></Callout
      >
      <DashboardPageLayout page="actualIncome" :registry="blocks" :default-layout="defaultLayout">
        <template #toolbar="{ grid }"
          ><div class="space-y-3">
            <header class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div>
                <h1 class="text-2xl font-semibold">Actual Income</h1>
                <p class="text-muted-foreground mt-0.5 text-sm">Recorded pay, base salary and compensation history.</p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <DropdownMenu
                  ><DropdownMenuTrigger as-child
                    ><Button variant="outline"
                      >Manage payroll<ChevronDownIcon class="ml-2 size-4" /></Button></DropdownMenuTrigger
                  ><DropdownMenuContent align="end" class="w-64"
                    ><template v-for="(item, i) in menus" :key="item.id"
                      ><DropdownMenuSeparator v-if="i === 3" /><DropdownMenuItem @select="management = item.id"
                        ><component :is="item.icon" class="size-4" />{{ item.name }}</DropdownMenuItem
                      ></template
                    ></DropdownMenuContent
                  ></DropdownMenu
                ><DashboardEditToolbar
                  :is-edit-mode="grid?.isEditMode ?? false"
                  :is-saving="grid?.isSaving"
                  @enter="grid?.enterEditMode()"
                  @save="grid?.saveLayout()"
                  @cancel="grid?.cancelEdit()"
                />
              </div>
            </header>
            <div class="flex flex-wrap items-center gap-2">
              <DateRange v-model="range" :earliest="data?.summary.coverageFrom ?? '1900-01-01'"
                ><template #actions
                  ><Popover
                    ><PopoverTrigger as-child
                      ><Button variant="ghost" size="icon" class="size-7" aria-label="Actual income settings"
                        ><SettingsIcon class="size-4" /></Button></PopoverTrigger
                    ><PopoverContent align="end" class="w-72"
                      ><label class="block space-y-2 text-sm"
                        >Employer<select
                          v-model="employmentId"
                          aria-label="Actual income employment"
                          class="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                        >
                          <option value="all">All employers</option>
                          <option v-for="employment in data?.employments" :key="employment.id" :value="employment.id">
                            {{ employment.employerName }} / {{ employment.jobTitle || 'Employment' }}
                          </option>
                        </select></label
                      ></PopoverContent
                    ></Popover
                  ></template
                ></DateRange
              >
            </div>
          </div></template
        >
        <template #actual-summary
          ><ActualSummary
            :data="data"
            :from="range.from"
            :through="range.through"
            :employment-id="employmentId === 'all' ? undefined : employmentId" /></template
        ><template #salary-history><SalaryHistory settings-key="payroll:actual:salary" /></template
        ><template #received-income><ReceivedIncome settings-key="payroll:actual:received" /></template
      ></DashboardPageLayout>
      <details v-if="data?.issues.length" class="text-muted-foreground rounded-lg border p-4 text-xs">
        <summary class="hover:text-primary-text cursor-pointer">
          Source and reconciliation notes ({{ data.issues.length }})
        </summary>
        <ul class="mt-3 list-inside list-disc space-y-1">
          <li v-for="(issue, i) in data.issues" :key="i">{{ issue }}</li>
        </ul>
      </details>
      <PayrollManagement v-if="data" v-model="management" :data="data" @saved="query.refetch()" /></div
  ></PageWrapper>
</template>
