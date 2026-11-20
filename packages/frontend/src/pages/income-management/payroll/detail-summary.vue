<script setup lang="ts">
import type { PayrollDashboard } from '@bt/shared/types/payroll';
import WidgetWrapper from '@/components/widgets/components/widget-wrapper.vue';
import ModuleBody from '@/components/widgets/components/module-body.vue';
import { useModuleLayout } from '@/components/widgets/composables/use-module-layout';
const { bounded } = useModuleLayout();
import { ArrowRightIcon, ArrowUpRightIcon, ArrowDownRightIcon } from '@lucide/vue';
import { incomeColors } from '../income-allocation';
import { computed } from 'vue';
import { usePayroll } from './use-payroll';
import { money } from './format';
import { payrollFieldUnavailable } from './completeness';
const props = defineProps<{
  kind: 'growth' | 'bonuses' | 'retirement' | 'taxes';
  data?: PayrollDashboard;
  from?: string;
  through?: string;
  employmentId?: string;
}>();
const query = usePayroll(() => ({ from: props.from, through: props.through, employmentId: props.employmentId }));
const data = computed(() => props.data ?? query.data.value),
  summary = computed(() => data.value?.summary);
const selectedStatements = computed(
  () =>
    data.value?.statements.filter(
      (statement) =>
        summary.value && statement.payDate >= summary.value.from && statement.payDate <= summary.value.through,
    ) ?? [],
);
const title = computed(
  () =>
    ({
      growth: 'Salary growth',
      bonuses: 'Bonuses and additional compensation',
      retirement: 'Actual retirement contributions',
      taxes: 'Actual taxes withheld',
    })[props.kind],
);
const rows = computed(() => {
  const s = summary.value;
  if (!s) return [];
  return props.kind === 'growth'
    ? [
        ['First recorded base salary', s.startingSalary],
        ['Previous base salary', s.previousSalary],
        ['Current base salary', s.currentSalary],
        ['Recorded salary growth', s.salaryGrowth],
        ['Current position growth', s.currentPositionGrowth ?? null],
        ['Year-over-year base salary growth', s.yearOverYearGrowth ?? null],
        ['All-time base salary growth', s.allTimeSalaryGrowth ?? null],
      ]
    : props.kind === 'bonuses'
      ? [
          ['Bonuses and awards', s.bonus],
          ['Additional earnings', s.additional],
          ['Noncash earnings', s.noncashEarnings],
        ]
      : props.kind === 'retirement'
        ? [
            ['Employee contributions', s.employeeRetirement],
            [
              'Employer match',
              payrollFieldUnavailable(data.value, 'employerContributionSplit', props.employmentId)
                ? null
                : s.employerMatch,
            ],
            [
              'Other employer retirement',
              payrollFieldUnavailable(data.value, 'employerContributionSplit', props.employmentId)
                ? null
                : s.employerOtherRetirement,
            ],
            ['Total retirement contributions', s.employeeRetirement + s.employerRetirement],
          ]
        : [
            ['Federal', payrollFieldUnavailable(data.value, 'withholding', props.employmentId) ? null : s.federal],
            ['State', payrollFieldUnavailable(data.value, 'withholding', props.employmentId) ? null : s.state],
            ['Local', payrollFieldUnavailable(data.value, 'withholding', props.employmentId) ? null : s.local],
            [
              'Social Security',
              payrollFieldUnavailable(data.value, 'withholding', props.employmentId) ? null : s.socialSecurity,
            ],
            ['Medicare', payrollFieldUnavailable(data.value, 'withholding', props.employmentId) ? null : s.medicare],
          ];
});
const withholdingIncomplete = computed(() => payrollFieldUnavailable(data.value, 'withholding', props.employmentId));
const taxTotal = computed(() =>
  summary.value && !withholdingIncomplete.value
    ? summary.value.federal +
      summary.value.state +
      summary.value.local +
      summary.value.socialSecurity +
      summary.value.medicare
    : null,
);
const careerVisible = computed(
  () => !!props.employmentId || (data.value?.employments.filter((e) => e.status === 'current').length ?? 0) <= 1,
);
</script>
<template>
  <WidgetWrapper class="@container min-h-0 min-w-0 overflow-hidden">
    <template #title>{{ title }}</template>
    <ModuleBody>
      <template v-if="summary">
        <template v-if="kind === 'growth' && careerVisible"
          ><div class="mt-5 flex items-center justify-between gap-3">
            <div>
              <p class="text-muted-foreground text-xs">Starting salary</p>
              <p class="mt-1 text-[clamp(1rem,6cqi,1.25rem)] font-semibold tabular-nums">
                {{ money(summary.startingSalary) }}
              </p>
            </div>
            <ArrowRightIcon class="text-muted-foreground size-5 shrink-0" />
            <div class="text-right">
              <p class="text-muted-foreground text-xs">Current salary</p>
              <p class="text-primary-text mt-1 text-[clamp(1rem,6cqi,1.25rem)] font-semibold tabular-nums">
                {{ money(summary.currentSalary) }}
              </p>
            </div>
          </div>
          <div
            :class="[
              'mt-5 flex flex-wrap items-center gap-2',
              (summary.salaryGrowth ?? 0) >= 0 ? 'text-success-text' : 'text-destructive-text',
            ]"
          >
            <ArrowUpRightIcon v-if="(summary.salaryGrowth ?? 0) >= 0" class="size-5" /><ArrowDownRightIcon
              v-else
              class="size-5"
            /><span class="text-3xl font-bold tracking-tight tabular-nums"
              >{{ (summary.salaryGrowth ?? 0) > 0 ? '+' : '' }}{{ money(summary.salaryGrowth) }}</span
            ><span
              v-if="summary.salaryGrowthPercent != null"
              class="rounded-full bg-current/10 px-2 py-1 text-sm font-semibold"
              >{{ summary.salaryGrowthPercent > 0 ? '+' : '' }}{{ summary.salaryGrowthPercent.toFixed(1) }}%</span
            >
          </div>
          <details class="mt-4">
            <summary class="hover:text-primary-text text-muted-foreground cursor-pointer text-xs">
              Career details
            </summary>
            <dl class="divide-border/50 mt-3 divide-y text-xs">
              <div
                v-for="[label, value] in rows.filter(
                  ([label]) =>
                    !['First recorded base salary', 'Current base salary', 'Recorded salary growth'].includes(
                      String(label),
                    ),
                )"
                :key="String(label)"
                class="flex justify-between gap-3 py-2"
              >
                <dt class="text-muted-foreground">{{ label }}</dt>
                <dd class="tabular-nums">{{ money(value as number | null) }}</dd>
              </div>
            </dl>
            <p v-if="summary.lastRaiseDate" class="text-muted-foreground mt-2 text-xs">
              Latest observed raise {{ summary.lastRaiseDate
              }}<template v-if="summary.daysSinceRaise != null"> / {{ summary.daysSinceRaise }} days ago</template>.
            </p>
            <p v-if="summary.employmentDurationDays != null" class="text-muted-foreground mt-2 text-xs">
              Verified employment duration: {{ summary.employmentDurationDays }} days.
            </p>
          </details></template
        >
        <p v-else-if="kind === 'growth'" class="text-muted-foreground mt-4 text-sm">
          Select one current employer in Income to compare salary growth.
        </p>
        <template v-if="kind === 'bonuses'"
          ><p class="text-primary-text mt-5 text-3xl font-bold tracking-tight tabular-nums">
            {{ money(payrollFieldUnavailable(data, 'regularEarnings', employmentId) ? null : summary.additional) }}
          </p>
          <p class="text-muted-foreground mt-1 text-xs">Additional earnings</p>
          <p v-if="summary.bonus !== summary.additional && summary.bonus" class="text-muted-foreground mt-3 text-sm">
            Bonuses and awards <b class="text-foreground ml-2">{{ money(summary.bonus) }}</b>
          </p>
          <details class="mt-4">
            <summary class="hover:text-primary-text text-muted-foreground cursor-pointer text-xs">
              Awards and earnings details
            </summary>
            <p v-if="summary.noncashEarnings" class="text-muted-foreground mt-3 text-xs">
              Includes {{ money(summary.noncashEarnings) }} noncash earnings; these are not additional bank deposits.
            </p>
            <div class="divide-border/50 mt-3 divide-y" :class="!bounded && 'max-h-64 overflow-auto'">
              <template v-for="statement in selectedStatements" :key="statement.id"
                ><div
                  v-for="(line, i) in statement.earnings.filter((l) => l.category !== 'regular' && l.amount)"
                  :key="i"
                  class="flex justify-between gap-4 py-2 text-xs"
                >
                  <span
                    ><span class="text-muted-foreground block">{{ statement.payDate }}</span
                    >{{ line.name }}</span
                  ><b class="tabular-nums">{{ money(line.amount) }}</b>
                </div></template
              >
            </div>
          </details></template
        >
        <template v-if="kind === 'retirement'"
          ><div class="mt-5 grid grid-cols-2 gap-3">
            <div class="bg-muted/30 @container min-w-0 rounded-lg border p-3">
              <p class="text-muted-foreground text-xs">Employee</p>
              <p class="text-primary-text mt-2 text-[clamp(0.875rem,15cqi,1.5rem)] font-bold tabular-nums">
                {{ money(summary.employeeRetirement) }}
              </p>
            </div>
            <div class="bg-muted/30 @container min-w-0 rounded-lg border p-3">
              <p class="text-muted-foreground text-xs">Employer</p>
              <p
                class="mt-2 text-[clamp(0.875rem,15cqi,1.5rem)] font-bold tabular-nums"
                :style="{ color: incomeColors.savingsInvestments }"
              >
                {{ money(summary.employerRetirement) }}
              </p>
            </div>
          </div>
          <details class="mt-4">
            <summary class="hover:text-primary-text text-muted-foreground cursor-pointer text-xs">
              Contribution details
            </summary>
            <dl class="divide-border/50 mt-3 divide-y text-xs">
              <div v-for="[label, value] in rows" :key="String(label)" class="flex justify-between gap-4 py-2">
                <dt class="text-muted-foreground">{{ label }}</dt>
                <dd class="tabular-nums">{{ money(value as number | null) }}</dd>
              </div>
            </dl>
          </details></template
        >
        <template v-if="kind === 'taxes'"
          ><p class="text-app-expense-color mt-5 text-3xl font-bold tracking-tight tabular-nums">
            {{ money(taxTotal) }}
          </p>
          <p class="text-muted-foreground mt-1 text-xs">Payroll withholding</p>
          <p v-if="withholdingIncomplete" class="text-muted-foreground mt-3 text-xs">
            Some payroll withholding fields are incomplete. Unavailable amounts are not verified zero taxes.
          </p>
          <div v-else class="mt-4 space-y-3">
            <div v-for="[label, value] in rows.filter(([, value]) => value !== 0)" :key="String(label)">
              <div class="flex justify-between gap-3 text-xs">
                <span class="text-muted-foreground">{{ label }}</span
                ><span class="font-medium tabular-nums">{{ money(value as number | null) }}</span>
              </div>
              <div class="bg-muted mt-1 h-1 rounded-full">
                <div
                  class="bg-app-expense-color h-full rounded-full"
                  :style="{ width: `${(Math.abs(Number(value)) / Math.max(Math.abs(taxTotal ?? 0), 1)) * 100}%` }"
                />
              </div>
            </div></div
        ></template>
      </template>
      <div v-else class="bg-muted mt-4 h-24 animate-pulse rounded-lg" />
    </ModuleBody>
  </WidgetWrapper>
</template>
