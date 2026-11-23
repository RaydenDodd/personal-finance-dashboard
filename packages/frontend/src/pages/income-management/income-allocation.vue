<script setup lang="ts">
import { computed, ref, nextTick } from 'vue';
import type { IncomePlanInput, IncomePlanResult } from '@bt/shared/finance-income';
import { Button } from '@/components/lib/ui/button';
import WidgetWrapper from '@/components/widgets/components/widget-wrapper.vue';
import ModuleBody from '@/components/widgets/components/module-body.vue';
import { useModuleLayout } from '@/components/widgets/composables/use-module-layout';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { SettingsIcon, ChartPieIcon, WorkflowIcon } from '@lucide/vue';
import DrilldownDonut from '@/components/common/charts/drilldown-donut.vue';
import MoneyFlowChart from '@/pages/analytics/subpages/cash-flow/components/money-flow-chart.vue';
import { incomeAllocation, incomeBreakdown } from './income-allocation';
import IncomeDetailRows from './income-detail-rows.vue';

const props = withDefaults(
  defineProps<{
    result: IncomePlanResult;
    input: IncomePlanInput;
    divisor: number;
    periodLabel: string;
    part?: 'all' | 'chart' | 'breakdown';
  }>(),
  { part: 'all' },
);
const view = defineModel<'donut' | 'flow'>('view', { default: 'donut' });
const expanded = ref<string[]>([]);
const { bounded } = useModuleLayout();
const allocation = computed(() => incomeAllocation(props.result, props.divisor));
const details = computed(() => incomeBreakdown(props.result, props.input, props.divisor));
const chartData = computed(() => allocation.value?.groups ?? []);
const money = (n: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
async function openGroup(id: string) {
  const ids = (
    {
      retirement: ['pre', 'post', 'employer'],
      savingsInvestments: ['savings'],
      otherDeductions: ['pre', 'post'],
    } as Record<string, string[]>
  )[id] ?? [id];
  expanded.value = [...new Set([...expanded.value, ...ids])];
  await nextTick();
  document.getElementById('income-group-' + ids[0])?.scrollIntoView({
    block: 'center',
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}
defineExpose({ openGroup });
function toggle(id: string) {
  expanded.value = expanded.value.includes(id) ? expanded.value.filter((key) => key !== id) : [...expanded.value, id];
}
</script>
<template>
  <WidgetWrapper
    class="@container min-h-0 min-w-0 overflow-hidden"
    :data-testid="part === 'breakdown' ? 'income-breakdown-card' : 'income-allocation'"
  >
    <template #title>{{ part === 'breakdown' ? 'Income breakdown' : 'Income allocation' }}</template>
    <template v-if="part !== 'breakdown'" #action>
      <slot name="action" /><Popover
        ><PopoverTrigger as-child
          ><Button variant="ghost" size="icon-sm" aria-label="Income allocation settings"
            ><SettingsIcon class="text-muted-foreground size-4" /></Button></PopoverTrigger
        ><PopoverContent align="end" class="w-40"
          ><div class="bg-muted/60 flex shrink-0 gap-0.5 rounded-lg p-0.5" role="group" aria-label="Allocation view">
            <Button
              size="icon-sm"
              aria-label="Doughnut"
              title="Doughnut"
              :variant="view === 'donut' ? 'secondary' : 'ghost'"
              :aria-pressed="view === 'donut'"
              @click="view = 'donut'"
              ><ChartPieIcon class="size-3.5"
            /></Button>
            <Button
              size="icon-sm"
              aria-label="Flow diagram"
              title="Flow diagram"
              :variant="view === 'flow' ? 'secondary' : 'ghost'"
              :aria-pressed="view === 'flow'"
              @click="view = 'flow'"
              ><WorkflowIcon class="size-3.5"
            /></Button>
          </div> </PopoverContent
      ></Popover>
    </template>
    <template v-if="allocation">
      <div v-if="part !== 'breakdown' && view === 'donut'" :class="bounded ? 'relative min-h-0 flex-1' : 'min-w-0'">
        <DrilldownDonut
          :data="chartData"
          :total="allocation.flow.income"
          label="Income allocation"
          :height-class="bounded ? 'h-44' : 'h-60'"
          :compact="part === 'chart'"
          :show-legend="false"
        />
      </div>
      <div
        v-else-if="part !== 'breakdown'"
        :class="bounded ? 'relative min-h-0 flex-1' : 'min-w-0'"
        role="region"
        aria-label="Income flow"
      >
        <MoneyFlowChart
          :fit-height="bounded"
          responsive
          :flow="allocation.flow"
          :branches="allocation.branches"
          total-label="Total income"
          chart-label="Income allocation flow diagram"
        />
      </div>
      <ModuleBody
        v-if="part !== 'chart'"
        class="divide-border/60 border-border/60 divide-y border-t"
        data-testid="income-breakdown"
      >
        <div
          v-for="group in details"
          :id="'income-group-' + group.id"
          :key="group.id"
          :style="{ borderLeft: '3px solid ' + group.color }"
        >
          <button
            v-if="group.children.length"
            type="button"
            class="group hover:bg-accent focus-visible:bg-accent flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-4 text-left transition-colors"
            :aria-expanded="expanded.includes(group.id)"
            :aria-controls="'income-details-' + group.id"
            @click="toggle(group.id)"
          >
            <span class="flex min-w-0 flex-wrap items-center gap-2"
              ><span class="size-2.5 rounded-full" :style="{ background: group.color }" />{{ group.name
              }}<span class="text-muted-foreground hidden text-xs group-hover:inline group-focus-visible:inline">{{
                expanded.includes(group.id) ? 'Hide details' : 'View details'
              }}</span></span
            >
            <span class="shrink-0 text-right font-semibold tabular-nums"
              >{{ money(group.amount)
              }}<span v-if="group.id !== 'income'" class="text-muted-foreground ml-2 text-xs font-medium"
                >{{ ((group.amount / allocation.flow.income) * 100).toFixed(1) }}%</span
              ></span
            >
          </button>
          <div v-else class="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <span class="flex items-center gap-3"
              ><span class="size-2.5 rounded-full" :style="{ background: group.color }" />{{ group.name }}</span
            ><span class="shrink-0 text-right font-semibold tabular-nums"
              >{{ money(group.amount)
              }}<span v-if="group.id !== 'income'" class="text-muted-foreground ml-2 text-xs font-medium"
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
      </ModuleBody>
    </template>
    <p v-else class="text-muted-foreground p-6 text-sm">Add salary and tax settings to view a balanced allocation.</p>
  </WidgetWrapper>
</template>
