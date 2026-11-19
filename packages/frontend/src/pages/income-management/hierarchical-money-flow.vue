<script setup lang="ts">
import type { IncomeFlowNode } from '@bt/shared/finance-income';
import { ChartTooltip, ChartTooltipHeader, ChartTooltipRow } from '@/components/common/charts/chart-tooltip';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { computed, reactive, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    root: IncomeFlowNode;
    displayMode?: 'percent' | 'amount' | 'both';
    periodDivisor?: number;
    incomingSources?: { name: string; amount: number }[];
  }>(),
  { displayMode: 'percent', periodDivisor: 1 },
);
const containerRef = ref<HTMLElement | null>(null),
  tooltipRef = ref<HTMLElement | null>(null);
const collapsed = ref<string[]>(['taxes', 'savingsInvestmentsRetirement', 'deductions']);
const activeNode = ref<string | null>(null);
const relatedIds = computed(() => {
  const ids = new Set<string>();
  function descend(n: IncomeFlowNode) {
    ids.add(n.id);
    for (const c of n.children ?? []) descend(c);
  }
  function find(n: IncomeFlowNode, parents: string[]): boolean {
    if (n.id === activeNode.value) {
      parents.forEach((id) => ids.add(id));
      descend(n);
      return true;
    }
    return (n.children ?? []).some((c) => find(c, [...parents, n.id]));
  }
  if (activeNode.value) find(props.root, []);
  return ids;
});
const overview = computed(() => [
  { id: props.root.id, name: 'Total income', amount: props.root.amount, color: '#7b65c1' },
  {
    id: 'taxes',
    name: 'Taxes',
    amount: props.root.children?.find((n) => n.id === 'taxes')?.amount ?? 0,
    color: '#e77066',
  },
  {
    id: 'savingsInvestmentsRetirement',
    name: 'Savings and retirement',
    amount: props.root.children?.find((n) => n.id === 'savingsInvestmentsRetirement')?.amount ?? 0,
    color: '#62b58a',
  },
  {
    id: 'spending',
    name: 'Cash to spend',
    amount: props.root.children?.find((n) => n.id === 'spending')?.amount ?? 0,
    color: '#55aebc',
  },
]);
const tooltip = reactive({ visible: false, x: 0, y: 0, node: null as IncomeFlowNode | null });
const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip, strategy: 'fixed' });
const money = (n: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(
    n / props.periodDivisor,
  );
const label = (n: IncomeFlowNode) =>
  props.displayMode === 'percent'
    ? `${n.percentOfTotal.toFixed(1)}%`
    : props.displayMode === 'amount'
      ? money(n.amount)
      : `${n.percentOfTotal.toFixed(1)}% · ${money(n.amount)}`;
const layout = computed(() => {
  const nodes: { node: IncomeFlowNode; depth: number; color: string; x: number; y: number; h: number }[] = [],
    links: { from: string; to: string; amount: number; color: string }[] = [];
  const colors: Record<string, string> = {
    taxes: '#e77066',
    savingsInvestmentsRetirement: '#62b58a',
    spending: '#55aebc',
    deductions: '#9b79e8',
  };
  function visit(node: IncomeFlowNode, depth: number, color: string) {
    if (node.amount <= 0) return;
    nodes.push({ node, depth, color, x: 210 + depth * 225, y: 0, h: 0 });
    if (!collapsed.value.includes(node.id))
      for (const child of node.children ?? []) {
        if (child.amount <= 0) continue;
        const tint = depth === 0 ? (colors[child.id] ?? '#7b65c1') : color;
        links.push({ from: node.id, to: child.id, amount: child.amount, color: tint });
        visit(child, depth + 1, tint);
      }
  }
  visit(props.root, 0, '#7b65c1');
  const scale = 400 / Math.max(props.root.amount, 1),
    groups = new Map<number, typeof nodes>();
  for (const node of nodes) {
    node.h = Math.max(22, node.node.amount * scale);
    const group = groups.get(node.depth) ?? [];
    group.push(node);
    groups.set(node.depth, group);
  }
  const height = Math.max(460, ...[...groups.values()].map((group) => group.reduce((s, n) => s + n.h + 28, 32)));
  for (const group of groups.values()) {
    let top = (height - group.reduce((s, n) => s + n.h + 28, 0)) / 2 + 14;
    for (const node of group) {
      node.y = top;
      top += node.h + 28;
    }
  }
  const map = new Map(nodes.map((n) => [n.node.id, n]));
  const outgoing = new Map<string, number>(),
    incoming = new Map<string, number>();
  const paths = links.map((link) => {
    const from = map.get(link.from)!,
      to = map.get(link.to)!;
    const thickness = link.amount * scale;
    const fy = from.y + (outgoing.get(link.from) ?? 0),
      ty = to.y + (incoming.get(link.to) ?? 0);
    outgoing.set(link.from, (outgoing.get(link.from) ?? 0) + thickness);
    incoming.set(link.to, (incoming.get(link.to) ?? 0) + thickness);
    const x = from.x + 12,
      tx = to.x,
      c = (x + tx) / 2;
    return {
      ...link,
      path: `M${x},${fy}C${c},${fy} ${c},${ty} ${tx},${ty}L${tx},${ty + thickness}C${c},${ty + thickness} ${c},${fy + thickness} ${x},${fy + thickness}Z`,
    };
  });
  const sources = (props.incomingSources ?? []).filter((s) => s.amount > 0);
  const root = map.get(props.root.id);
  if (!root) return { nodes, paths, incomingSources: [], height: 180, width: 800 };
  let cursor = root.y;
  const incomingSources = sources.map((source) => {
    const h = source.amount * scale;
    const start = cursor;
    cursor += h;
    return {
      ...source,
      y: start,
      h,
      path: `M12,${start}C110,${start} 110,${start} ${root.x},${start}L${root.x},${start + h}C110,${start + h} 110,${start + h} 12,${start + h}Z`,
    };
  });
  return { nodes, paths, incomingSources, height, width: Math.max(800, ...nodes.map((n) => n.x + 215)) };
});
function toggle(node: IncomeFlowNode) {
  if (!node.children?.length) return;
  collapsed.value = collapsed.value.includes(node.id)
    ? collapsed.value.filter((id) => id !== node.id)
    : [...collapsed.value, node.id];
}
function show(event: PointerEvent, node: IncomeFlowNode) {
  activeNode.value = node.id;
  tooltip.node = node;
  tooltip.visible = true;
  updateTooltipPosition(event);
}
function showLink(event: PointerEvent, id: string) {
  const node = layout.value.nodes.find((n) => n.node.id === id)?.node;
  if (node) show(event, node);
}
function lines(name: string) {
  const words = name.split(' '),
    result: string[] = [];
  for (const word of words) {
    if (!result.length || result.at(-1)!.length + word.length > 26) result.push(word);
    else result[result.length - 1] += ' ' + word;
  }
  return result.slice(0, 3);
}
</script>
<template>
  <div ref="containerRef" class="relative">
    <div class="divide-border/60 border-border/60 mb-5 grid grid-cols-2 gap-y-4 divide-x border-y py-4 sm:grid-cols-4">
      <div
        v-for="item in overview"
        :key="item.name"
        class="px-3"
        @pointerenter="activeNode = item.id"
        @pointerleave="activeNode = null"
      >
        <p class="text-muted-foreground flex items-center gap-2 text-xs">
          <span class="size-2 rounded-sm" :style="{ background: item.color }" />{{ item.name }}
        </p>
        <p class="mt-2 text-lg font-semibold tabular-nums">{{ money(item.amount) }}</p>
      </div>
    </div>
    <p class="text-muted-foreground mb-3 text-xs">
      Every percentage uses Total Compensation. Tap a category to expand or collapse. Scroll horizontally for detailed
      branches.
    </p>
    <p v-if="root.amount <= 0" class="text-muted-foreground py-8 text-center text-sm">
      Enter income to view its allocation.
    </p>
    <div v-else class="overflow-x-auto">
      <svg
        :width="layout.width"
        :height="layout.height"
        role="img"
        aria-label="Income allocation flow diagram"
        class="block min-w-full"
      >
        <g v-for="source in layout.incomingSources" :key="source.name">
          <path :d="source.path" fill="#7b65c1" opacity="0.15" />
          <rect x="0" :y="source.y" width="12" :height="Math.max(source.h, 2)" rx="3" fill="#7b65c1" />
          <text x="18" :y="source.y + Math.max(source.h / 2, 12)" class="fill-foreground text-xs">
            {{ source.name }}
            <tspan x="18" dy="16">{{ ((source.amount / root.amount) * 100).toFixed(1) }}%</tspan>
          </text>
        </g>
        <path
          v-for="link in layout.paths"
          :key="link.from + '-' + link.to"
          :d="link.path"
          :fill="link.color"
          :opacity="!activeNode ? 0.18 : relatedIds.has(link.from) && relatedIds.has(link.to) ? 0.5 : 0.035"
          class="transition-opacity"
          @pointerenter="showLink($event, link.to)"
          @pointermove="showLink($event, link.to)"
          @pointerleave="
            tooltip.visible = false;
            activeNode = null;
          "
        />
        <g
          v-for="entry in layout.nodes"
          :key="entry.node.id"
          role="button"
          tabindex="0"
          :aria-label="entry.node.name + ' ' + label(entry.node)"
          :aria-expanded="entry.node.children?.length ? !collapsed.includes(entry.node.id) : undefined"
          class="cursor-pointer transition-opacity"
          style="outline: none"
          :opacity="!activeNode || relatedIds.has(entry.node.id) ? 1 : 0.3"
          @click="toggle(entry.node)"
          @keydown.enter="toggle(entry.node)"
          @pointerenter="show($event, entry.node)"
          @pointermove="show($event, entry.node)"
          @pointerleave="
            tooltip.visible = false;
            activeNode = null;
          "
          @focus="activeNode = entry.node.id"
          @blur="activeNode = null"
          @pointerdown="show($event, entry.node)"
        >
          <rect :x="entry.x" :y="entry.y" width="12" :height="entry.h" rx="3" :fill="entry.color" />
          <text :x="entry.x + 18" :y="entry.y + Math.max(entry.h / 2 - 17, 13)" class="fill-foreground text-xs">
            <tspan v-for="(line, index) in lines(entry.node.name)" :key="line" :x="entry.x + 18" :dy="index ? 14 : 0">
              {{ line }}
            </tspan>
            <tspan :x="entry.x + 18" dy="17" class="font-semibold">
              {{ label(entry.node) }}
              {{ entry.node.children?.length ? (collapsed.includes(entry.node.id) ? '+' : '−') : '' }}
            </tspan>
          </text>
        </g>
      </svg>
    </div>
    <div
      v-show="tooltip.visible && tooltip.node"
      ref="tooltipRef"
      class="pointer-events-none fixed z-50"
      :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
    >
      <ChartTooltip v-if="tooltip.node"
        ><ChartTooltipHeader>{{ tooltip.node.name }}</ChartTooltipHeader
        ><ChartTooltipRow label="Amount" :value="money(tooltip.node.amount)" /><ChartTooltipRow
          label="% of Total Compensation"
          :value="tooltip.node.percentOfTotal.toFixed(2) + '%'" /><ChartTooltipRow
          label="% of parent category"
          :value="tooltip.node.percentOfParent.toFixed(2) + '%'"
      /></ChartTooltip>
    </div>
  </div>
</template>
