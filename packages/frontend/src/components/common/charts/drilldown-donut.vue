<script setup lang="ts">
import { useModuleLayout } from '@/components/widgets/composables/use-module-layout';
import { computed, inject, ref, watch, type Ref } from 'vue';
import { ChevronLeftIcon } from '@lucide/vue';
import { Button } from '@/components/lib/ui/button';
import ExpenseDonut from '@/components/widgets/expenses-structure/donut-chart.vue';
import { CATEGORICAL_SERIES_PALETTE as colors } from '@/composable/charts/categorical-series-palette';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
export interface DonutNode {
  id: string;
  name: string;
  amount: number;
  color?: string;
  children?: DonutNode[];
}
const props = withDefaults(
  defineProps<{
    data: DonutNode[];
    total: number;
    label: string;
    heightClass?: string;
    compact?: boolean;
    showLegend?: boolean;
  }>(),
  { heightClass: 'h-64', showLegend: true },
);
const { bounded } = useModuleLayout();
const incomeHeight = inject<Ref<number> | null>('income-chart-height', null);
const investmentHeight = inject<Ref<number> | null>('investment-chart-height', null);
const plotHeight = computed(() =>
  bounded.value && !props.showLegend
    ? Math.max(140, (incomeHeight?.value ?? (investmentHeight?.value ?? 248) + 40) - (current.value ? 32 : 0))
    : undefined,
);
const path = ref<string[]>([]);
// Tiny 2px-bordered arcs disappear on a phone. Keep them accessible in a nested pie.
function levelRows(nodes: DonutNode[]): DonutNode[] {
  if (nodes.length <= 12) return nodes;
  const sorted = [...nodes].sort((a, b) => b.amount - a.amount),
    rest = sorted.slice(11);
  return [
    ...sorted.slice(0, 11),
    { id: '__other__', name: 'Other holdings', amount: rest.reduce((sum, n) => sum + n.amount, 0), children: rest },
  ];
}
const trail = computed(() => {
  const found: DonutNode[] = [];
  let level = levelRows(props.data);
  for (const id of path.value) {
    const node = level.find((n) => n.id === id);
    if (!node?.children?.length) break;
    found.push(node);
    level = levelRows(node.children);
  }
  return found;
});
watch(trail, (value) => {
  if (value.length < path.value.length) path.value = path.value.slice(0, value.length);
});
const current = computed(() => trail.value.at(-1));
const rows = computed(() => levelRows(current.value?.children ?? props.data));
const displayTotal = computed(() => current.value?.amount ?? props.total);
const chartData = computed(() =>
  rows.value
    .filter((r) => r.amount > 0)
    .map((r, i) => ({
      categoryId: r.id,
      name: r.name,
      amount: r.amount,
      color: r.color ?? colors[i % colors.length]!,
    })),
);
const selected = ref<string | null>(null);
function select(id: string) {
  const row = rows.value.find((r) => r.id === id);
  if (row?.children?.some((c) => c.amount > 0)) {
    path.value = [...path.value, id];
    selected.value = null;
  } else selected.value = id;
}
const money = (n: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
</script>
<template>
  <div class="flex min-h-0 min-w-0 flex-col" data-testid="drilldown-donut">
    <Button
      v-if="current"
      variant="ghost"
      size="sm"
      class="mb-1 max-w-full self-start px-1"
      :aria-label="'Back from ' + current.name"
      @click="
        path = path.slice(0, -1);
        selected = null;
      "
      ><ChevronLeftIcon class="size-4 shrink-0" /><span class="truncate">{{ current.name }}</span></Button
    >
    <ExpenseDonut
      :data="chartData"
      :total-amount="displayTotal"
      :total-label="current?.name ?? label"
      :chart-label="label + ' doughnut'"
      :height-class="heightClass"
      :style="plotHeight ? { height: plotHeight + 'px' } : undefined"
      selection-mode="highlight"
      show-percentages
      @category-click="select($event.categoryId)"
    />
    <ScrollArea
      v-if="showLegend"
      :class="bounded ? 'max-h-24' : compact ? 'max-h-36' : 'max-h-56'"
      :viewport-class="bounded ? 'max-h-24' : compact ? 'max-h-36' : 'max-h-56'"
    >
      <div class="grid gap-0.5">
        <button
          v-for="(row, i) in rows"
          :key="row.id"
          type="button"
          class="hover:bg-accent flex min-h-9 min-w-0 items-center justify-between gap-2 rounded px-1 text-left text-xs"
          :aria-pressed="selected === row.id"
          @click="select(row.id)"
        >
          <span class="flex min-w-0 items-center gap-2"
            ><span
              class="size-2 shrink-0 rounded-full"
              :style="{ background: row.color ?? colors[i % colors.length] }"
            /><span class="truncate">{{ row.name }}</span></span
          >
          <span class="shrink-0 tabular-nums"
            >{{ money(row.amount) }}
            <span class="text-muted-foreground">{{
              displayTotal > 0 ? ((row.amount / displayTotal) * 100).toFixed(1) + '%' : ''
            }}</span></span
          >
        </button>
      </div>
    </ScrollArea>
  </div>
</template>
