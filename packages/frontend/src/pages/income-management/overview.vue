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
import { computed, onMounted, ref, watch } from 'vue';
import IncomeSettings from './taxes.vue';
import PaycheckManager from './index.vue';
import PeriodButtons from './period-buttons.vue';
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
const historyMode = ref<'salary' | 'received'>('salary'),
  period = ref<'monthly' | 'yearly' | 'biweekly'>('monthly');
const divisor = computed(() => (period.value === 'monthly' ? 12 : period.value === 'biweekly' ? 26 : 1)),
  expanded = ref<string[]>([]);
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
const colors = {
  taxes: '#e77066',
  pre: '#5b83ed',
  post: '#9b79e8',
  employer: '#b68a36',
  savings: '#62b58a',
  spending: '#55aebc',
};
type Group = { id: string; name: string; color: string; amount: number; rows: { name: string; amount: number }[] };
const groups = computed<Group[]>(() => {
  const a = result.value?.annual,
    i = current.value?.input;
  if (!a || !i || !result.value?.available) return [];
  const h = i.hsaThroughPayroll ? a.hsa : 0;
  const deductionRows = (pre: boolean) => {
    const nodes = result.value?.flow?.children?.find((n) => n.id === 'deductions')?.children;
    if (!nodes)
      return [
        {
          name: pre ? 'Other before-tax deductions' : 'Other after-tax deductions',
          amount: pre ? a.otherPreTaxDeductions : a.otherPostTaxDeductions,
        },
      ];
    return i.deductions
      .filter((d) => d.reducesIncomeTax === pre)
      .map((d) => ({ name: d.name, amount: nodes.find((n) => n.id === 'deduction-' + d.id)?.amount ?? 0 }));
  };
  return [
    {
      id: 'taxes',
      name: 'Taxes',
      color: colors.taxes,
      amount: a.taxes!,
      rows: [
        { name: 'Federal income tax', amount: a.federalTax! },
        { name: 'State income tax', amount: a.stateTax! },
        { name: 'Local income tax', amount: a.localTax! },
        { name: 'Social Security', amount: a.socialSecurity! },
        { name: 'Medicare', amount: a.medicare! },
      ],
    },
    {
      id: 'pre',
      name: 'Before-tax deductions',
      color: colors.pre,
      amount: a.traditional401k + a.otherPreTaxDeductions + h,
      rows: [
        { name: 'Traditional 401(k)', amount: a.traditional401k },
        { name: 'Payroll HSA', amount: h },
        ...deductionRows(true),
      ],
    },
    {
      id: 'post',
      name: 'After-tax contributions and deductions',
      color: colors.post,
      amount: a.roth401k + a.traditionalIra + a.rothIra + a.otherPostTaxDeductions + a.hsa - h,
      rows: [
        { name: 'Roth 401(k)', amount: a.roth401k },
        { name: 'Traditional IRA', amount: a.traditionalIra },
        { name: 'Roth IRA', amount: a.rothIra },
        { name: 'Outside-payroll HSA', amount: a.hsa - h },
        ...deductionRows(false),
      ],
    },
    {
      id: 'employer',
      name: 'Employer retirement contributions',
      color: colors.employer,
      amount: a.employerMatch + a.employerOtherContribution,
      rows: [
        { name: '401(k) match', amount: a.employerMatch },
        { name: i.employerOtherContributionName || 'Other retirement', amount: a.employerOtherContribution },
      ],
    },
    {
      id: 'savings',
      name: 'Savings and investments',
      color: colors.savings,
      amount: a.savings! + a.investments!,
      rows: [
        { name: 'Savings', amount: a.savings! },
        { name: 'Investments', amount: a.investments! },
      ],
    },
    {
      id: 'spending',
      name: 'Spendable income',
      color: colors.spending,
      amount: a.spendable!,
      rows: [{ name: 'Available after taxes, contributions and allocations', amount: a.spendable! }],
    },
  ];
});
const pieSeries = computed(
  () =>
    result.value?.allocations.map((a) => ({
      id: a.id,
      name: a.label,
      color:
        (
          {
            taxes: colors.taxes,
            retirement: colors.post,
            savingsInvestments: colors.savings,
            spending: colors.spending,
            otherDeductions: colors.pre,
          } as Record<string, string>
        )[a.id] ?? colors.employer,
    })) ?? [],
);
const pieRows = computed<ChartRow[]>(() => [
  {
    label: period.value + ' allocation',
    values: Object.fromEntries(result.value?.allocations.map((a) => [a.id, a.yearly / divisor.value]) ?? []),
  },
]);
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
const receivedRows = computed<ChartRow[]>(
  () => data.value?.periods.map((p) => ({ label: p.date, values: { income: p.actualNet } })) ?? [],
);
const receivedYtd = computed(
  () =>
    data.value?.bankIncome
      .filter((p) => p.date.startsWith(String(new Date().getFullYear())))
      .reduce((s, p) => s + p.amount, 0) ?? 0,
);
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
function toggle(id: string) {
  expanded.value = expanded.value.includes(id) ? expanded.value.filter((x) => x !== id) : [...expanded.value, id];
}
async function selectSlice(id: string) {
  const ids = (
    {
      taxes: ['taxes'],
      retirement: ['pre', 'post', 'employer'],
      savingsInvestments: ['savings'],
      otherDeductions: ['pre', 'post'],
      spending: ['spending'],
    } as Record<string, string[]>
  )[id] ?? [id];
  expanded.value = [...new Set([...expanded.value, ...ids])];
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
        <div>
          <h1 class="text-2xl font-semibold">Income</h1>
          <p class="text-muted-foreground mt-1 text-sm">Your salary, take-home pay and where it goes.</p>
        </div>
        <Button variant="outline" @click="paychecksOpen = true">Paychecks</Button>
      </header>
      <Callout v-if="error" variant="destructive">{{ error }}</Callout>
      <Card class="p-5 sm:p-7"
        ><div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-muted-foreground text-sm">Yearly income</p>
            <p class="mt-2 text-4xl font-semibold tracking-tight">{{ money(result?.annual.gross) }}</p>
            <p v-if="current?.input.annualBonus" class="text-muted-foreground mt-2 text-sm">
              Includes {{ money(current.input.annualBonus) }} bonus
            </p>
          </div>
          <Button @click="editSalary()">Edit salary</Button>
        </div>
        <div class="border-border mt-6 grid gap-5 border-t pt-5 sm:grid-cols-3">
          <div>
            <p class="text-muted-foreground text-xs">Monthly take-home estimate</p>
            <p class="mt-1 text-xl font-semibold">
              {{ money(result?.annual.takeHome == null ? null : result.annual.takeHome / 12) }}
            </p>
          </div>
          <div>
            <p class="text-muted-foreground text-xs">Monthly spendable estimate</p>
            <p class="mt-1 text-xl font-semibold">
              {{ money(result?.annual.spendable == null ? null : result.annual.spendable / 12) }}
            </p>
          </div>
          <div>
            <p class="text-muted-foreground text-xs">Received from connected accounts · year to date</p>
            <p class="mt-1 text-xl font-semibold">{{ money(receivedYtd) }}</p>
          </div>
        </div></Card
      >
      <Card class="p-5 sm:p-6"
        ><div class="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-lg font-semibold">Income history</h2>
          <div class="flex flex-wrap gap-2">
            <Button
              size="sm"
              :variant="historyMode === 'salary' ? 'default' : 'outline'"
              @click="historyMode = 'salary'"
              >Salary history</Button
            ><Button
              size="sm"
              :variant="historyMode === 'received' ? 'default' : 'outline'"
              @click="historyMode = 'received'"
              >Received income</Button
            ><Button size="sm" variant="ghost" @click="editSalary(true)">Add earlier salary</Button>
          </div>
        </div>
        <FinanceChart
          :rows="historyMode === 'salary' ? salaryRows : receivedRows"
          :series="[
            {
              id: 'income',
              name: historyMode === 'salary' ? 'Yearly salary' : 'Monthly received income',
              color: '#7b65c1',
            },
          ]"
          mode="line"
        />
        <p class="text-muted-foreground mt-3 text-xs">
          {{
            historyMode === 'salary'
              ? 'Your recorded salary changes across the full available history. Add earlier salaries to fill in past years; unknown dates are not invented.'
              : 'All available posted income from connected accounts, grouped by month. Transfers and linked refunds are excluded.'
          }}
        </p></Card
      >
      <Card class="p-5 sm:p-6"
        ><div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">Take-home allocation</h2>
            <p class="text-muted-foreground mt-1 text-sm">
              Hover for details. Select a section to highlight its breakdown.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <PeriodButtons v-model="period" /><Button variant="outline" @click="settingsOpen = true"
              >Edit contributions</Button
            >
          </div>
        </div>
        <FinanceChart
          v-if="result?.available && result.flow"
          :rows="pieRows"
          :series="pieSeries"
          mode="donut"
          :donut-label="`${period === 'biweekly' ? 'Biweekly' : period === 'monthly' ? 'Monthly' : 'Yearly'} compensation`"
          donut-details
          @select-series="selectSlice"
        />
        <p v-else class="text-muted-foreground py-10 text-center">
          Enter your salary and tax details to see your allocation.
        </p>
        <p class="text-muted-foreground mt-3 text-xs">
          Percentages include employer retirement contributions. Estimates use your saved salary and tax settings.
        </p></Card
      >
      <Card class="overflow-hidden"
        ><div class="flex flex-wrap items-center justify-between gap-3 p-5">
          <h2 class="text-lg font-semibold">Take-home breakdown</h2>
          <PeriodButtons v-model="period" />
        </div>
        <div
          v-for="group in groups"
          :id="'income-group-' + group.id"
          :key="group.id"
          class="border-border border-t"
          :style="{ borderLeft: '4px solid ' + group.color }"
        >
          <button
            type="button"
            class="group hover:bg-accent focus-visible:bg-accent flex w-full items-center justify-between gap-3 px-5 py-5 text-left transition-colors focus-visible:outline-none"
            :aria-expanded="expanded.includes(group.id)"
            :aria-controls="'income-details-' + group.id"
            @click="toggle(group.id)"
          >
            <span class="flex min-w-0 items-center gap-3"
              ><span class="size-3 shrink-0 rounded-full" :style="{ background: group.color }" /><span
                class="font-medium"
                >{{ group.name
                }}<span
                  class="text-muted-foreground mt-1 block text-xs font-normal opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-sm:opacity-100"
                  >{{ expanded.includes(group.id) ? 'Hide details' : 'View details' }}</span
                ></span
              ></span
            ><span class="shrink-0 text-lg font-semibold tabular-nums" :style="{ color: group.color }">{{
              money(group.amount / divisor)
            }}</span>
          </button>
          <div
            v-if="expanded.includes(group.id)"
            :id="'income-details-' + group.id"
            class="divide-border/50 divide-y px-5 pb-4"
            :style="{ background: group.color + '0a' }"
          >
            <div
              v-for="row in group.rows"
              :key="row.name"
              class="flex items-center justify-between gap-4 rounded-md px-3 py-3 text-sm"
            >
              <span class="text-muted-foreground">{{ row.name }}</span
              ><span class="shrink-0 tabular-nums">{{ money(row.amount / divisor) }}</span>
            </div>
          </div>
        </div>
        <div v-if="result?.available" class="bg-muted/40 flex justify-between gap-4 p-5 font-semibold">
          <span>Total compensation</span
          ><span class="tabular-nums">{{ money(result.annual.totalComp / divisor) }}</span>
        </div>
        <p class="text-muted-foreground p-5 text-xs">
          Take-home is your pay after payroll deductions. Savings, investments and IRA allocations are separate from
          payroll. Employer contributions do not reduce your take-home.
        </p></Card
      >
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
          ><IncomeSettings v-if="settingsOpen" @saved="settingsOpen = false" /></DialogScrollContent
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
