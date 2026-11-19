<script setup lang="ts">
import { computed, ref } from 'vue';
import type { IncomePlanResult } from '@bt/shared/finance-income';
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import ExpenseDonut from '@/components/widgets/expenses-structure/donut-chart.vue';
import MoneyFlowChart from '@/pages/analytics/subpages/cash-flow/components/money-flow-chart.vue';
import { incomeAllocation } from './income-allocation';
import IncomeDetailRows from './income-detail-rows.vue';

const props = defineProps<{ result: IncomePlanResult; divisor: number; periodLabel: string }>();
const view = ref<'donut' | 'flow'>('donut');
const expanded = ref<string[]>([]);
const allocation = computed(() => incomeAllocation(props.result, props.divisor));
const chartData = computed(
  () =>
    allocation.value?.groups
      .filter((g) => g.amount > 0)
      .map((g) => ({
        categoryId: g.id,
        name: g.name,
        color: g.color,
        amount: g.amount,
      })) ?? [],
);
const money = (n: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
function select({ categoryId }: { categoryId: string }) {
  if (!expanded.value.includes(categoryId)) expanded.value.push(categoryId);
}
function toggle(id: string) {
  expanded.value = expanded.value.includes(id) ? expanded.value.filter((key) => key !== id) : [...expanded.value, id];
}
</script>
<template>
  <Card class="overflow-hidden" data-testid="income-allocation">
    <div class="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
      <h2 class="text-lg font-semibold">Income allocation</h2>
      <div class="flex gap-1" role="group" aria-label="Allocation view">
        <Button
          size="sm"
          :variant="view === 'donut' ? 'secondary' : 'ghost'"
          :aria-pressed="view === 'donut'"
          @click="view = 'donut'"
          >Doughnut</Button
        >
        <Button
          size="sm"
          :variant="view === 'flow' ? 'secondary' : 'ghost'"
          :aria-pressed="view === 'flow'"
          @click="view = 'flow'"
          >Flow diagram</Button
        >
      </div>
    </div>
    <template v-if="allocation">
      <div v-if="view === 'donut'" class="px-5 pb-5">
        <ExpenseDonut
          :data="chartData"
          :total-amount="allocation.flow.income"
          :total-label="periodLabel + ' income'"
          chart-label="Income allocation doughnut"
          height-class="h-72 sm:h-80"
          show-percentages
          selection-mode="highlight"
          @category-click="select"
        />
      </div>
      <div
        v-else
        class="max-w-full overflow-x-auto overscroll-x-contain px-5 pb-6"
        role="region"
        aria-label="Income flow, scroll for details"
        tabindex="0"
      >
        <MoneyFlowChart
          class="min-w-190"
          :flow="allocation.flow"
          :branches="allocation.branches"
          total-label="Total income"
          chart-label="Income allocation flow diagram"
        />
      </div>
      <div class="divide-border/60 border-border/60 divide-y border-t" data-testid="income-breakdown">
        <div v-for="group in allocation.groups" :key="group.id" :style="{ borderLeft: '3px solid ' + group.color }">
          <button
            v-if="group.children.length"
            type="button"
            class="group hover:bg-accent focus-visible:bg-accent flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors"
            :aria-expanded="expanded.includes(group.id)"
            :aria-controls="'income-details-' + group.id"
            @click="toggle(group.id)"
          >
            <span class="flex items-center gap-3"
              ><span class="size-2.5 rounded-full" :style="{ background: group.color }" />{{ group.name
              }}<span
                class="text-muted-foreground text-xs opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                >{{ expanded.includes(group.id) ? 'Hide details' : 'View details' }}</span
              ></span
            >
            <span class="shrink-0 text-right font-semibold tabular-nums"
              >{{ money(group.amount)
              }}<span class="text-muted-foreground ml-2 text-xs font-medium"
                >{{ ((group.amount / allocation.flow.income) * 100).toFixed(1) }}%</span
              ></span
            >
          </button>
          <div v-else class="flex items-center justify-between gap-4 px-5 py-4">
            <span class="flex items-center gap-3"
              ><span class="size-2.5 rounded-full" :style="{ background: group.color }" />{{ group.name }}</span
            ><span class="shrink-0 text-right font-semibold tabular-nums"
              >{{ money(group.amount)
              }}<span class="text-muted-foreground ml-2 text-xs font-medium"
                >{{ ((group.amount / allocation.flow.income) * 100).toFixed(1) }}%</span
              ></span
            >
          </div>
          <IncomeDetailRows
            v-if="expanded.includes(group.id) && group.children.length"
            :id="'income-details-' + group.id"
            :rows="group.children"
            class="bg-muted/20 border-border/50 mx-5 mb-4 border-t"
          />
        </div>
      </div>
    </template>
    <p v-else class="text-muted-foreground p-6 text-sm">Add salary and tax settings to view a balanced allocation.</p>
  </Card>
</template>
