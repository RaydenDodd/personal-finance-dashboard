<script setup lang="ts">
import type { PayrollDashboard } from '@bt/shared/types/payroll';
import { Card } from '@/components/lib/ui/card';
import { computed } from 'vue';
import { usePayroll } from './use-payroll';
import { money } from './format';
import { incomeColors } from '../income-allocation';
import { payrollFieldUnavailable } from './completeness';
const props = defineProps<{ data?: PayrollDashboard; from?: string; through?: string; employmentId?: string }>();
const query = usePayroll(() => ({ from: props.from, through: props.through, employmentId: props.employmentId }));
const payroll = computed(() => props.data ?? query.data.value);
const summary = computed(() => payroll.value?.summary);
const withholdingIncomplete = computed(() => payrollFieldUnavailable(payroll.value, 'withholding', props.employmentId));
const taxes = computed(() =>
  summary.value
    ? summary.value.federal +
      summary.value.state +
      summary.value.local +
      summary.value.socialSecurity +
      summary.value.medicare
    : null,
);
const categories = computed(() =>
  summary.value
    ? [
        { label: 'Gross earnings', value: summary.value.gross, color: incomeColors.income },
        { label: 'Take-home pay', value: summary.value.net, color: incomeColors.spending },
        { label: 'Taxes withheld', value: withholdingIncomplete.value ? null : taxes.value, color: incomeColors.taxes },
        { label: 'Employee retirement', value: summary.value.employeeRetirement, color: incomeColors.retirement },
        {
          label: 'Employer retirement',
          value: summary.value.employerRetirement,
          color: incomeColors.savingsInvestments,
        },
        { label: 'Total compensation', value: summary.value.totalCompensation, color: incomeColors.retirement },
      ]
    : [],
);
</script>
<template>
  <Card class="@container p-5 sm:p-7" data-testid="actual-payroll-summary">
    <div v-if="summary" class="space-y-5">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-muted-foreground text-xs font-medium">Current annualized base salary</p>
          <p class="text-primary-text mt-2 text-4xl font-semibold tracking-tight tabular-nums">
            {{ money(summary.currentSalary) }}
          </p>
          <p class="text-muted-foreground mt-2 text-xs">
            {{ summary.currentEmployer ?? 'No current employer recorded'
            }}<template v-if="summary.currentJobTitle"> / {{ summary.currentJobTitle }}</template>
          </p>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3 @3xl:grid-cols-3">
        <div
          v-for="item in categories"
          :key="item.label"
          class="border-border/50 bg-muted/20 min-w-0 rounded-lg border px-3 py-4 sm:px-4"
        >
          <p class="text-muted-foreground text-xs font-medium">{{ item.label }}</p>
          <p class="mt-2 text-2xl font-bold tracking-tight tabular-nums @2xl:text-3xl" :style="{ color: item.color }">
            {{ money(item.value) }}
          </p>
        </div>
      </div>
      <p v-if="withholdingIncomplete" class="text-muted-foreground text-xs">
        Tax withholding is incomplete for this period. Unavailable amounts are not treated as verified zero withholding.
      </p>
      <p v-if="payroll?.includedAnnualEvidence?.length" class="text-muted-foreground text-xs">
        Includes verified {{ payroll.includedAnnualEvidence.map((e) => e.year).join(', ') }} YTD history once.
        Individual paycheck dates are unavailable for that history.
      </p>
      <details>
        <summary class="hover:text-primary-text text-muted-foreground cursor-pointer text-xs">
          Compensation details
        </summary>
        <dl class="divide-border/50 mt-3 divide-y text-sm">
          <div
            v-for="item in [
              {
                label: 'Employer match',
                value: payrollFieldUnavailable(payroll, 'employerContributionSplit', employmentId)
                  ? null
                  : summary.employerMatch,
              },
              {
                label: 'Other employer retirement',
                value: payrollFieldUnavailable(payroll, 'employerContributionSplit', employmentId)
                  ? null
                  : summary.employerOtherRetirement,
              },
              { label: 'Benefits', value: summary.benefits },
              { label: 'Other deductions', value: summary.otherDeductions },
              { label: 'Bonuses and awards', value: summary.bonus },
              {
                label: 'Additional earnings',
                value: payrollFieldUnavailable(payroll, 'regularEarnings', employmentId) ? null : summary.additional,
              },
              { label: 'Noncash earnings', value: summary.noncashEarnings },
            ]"
            :key="item.label"
            class="flex justify-between gap-4 py-2"
          >
            <dt class="text-muted-foreground">{{ item.label }}</dt>
            <dd class="font-medium tabular-nums">{{ money(item.value) }}</dd>
          </div>
        </dl>
        <p class="text-muted-foreground mt-3 text-xs">
          {{ summary.from }} &ndash; {{ summary.through }} / {{ summary.count }} statements. Total compensation includes
          employer retirement. Withholding is not final tax liability.
        </p>
      </details>
      <p v-if="!summary.count" class="text-muted-foreground text-sm">
        No payroll statements in this period. Import payroll files from Manage payroll.
      </p>
    </div>
    <p v-else-if="query.isError.value" class="text-destructive-text text-sm">Payroll could not be loaded. Try again.</p>
    <div v-else class="bg-muted h-40 animate-pulse rounded-md" />
  </Card>
</template>
