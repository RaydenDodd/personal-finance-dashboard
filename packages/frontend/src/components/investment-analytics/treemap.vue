<script setup lang="ts">
import { computed, inject, nextTick, reactive, ref, watch, useId, type Ref } from 'vue';
import * as d3 from 'd3';
import { useResizeObserver } from '@vueuse/core';
import { ChartTooltip, ChartTooltipHeader, ChartTooltipRow } from '@/components/common/charts/chart-tooltip';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import type { InvestmentAnalytics } from '@bt/shared/types/investment-analytics';
import { investmentTreemapRows } from './treemap-model';
import { usesCustomPositionPeriod } from './performers-model';
const props = defineProps<{ analytics: InvestmentAnalytics; settings: Record<string, unknown>; compact?: boolean }>();
const chartHeight = inject<Ref<number> | null>('investment-chart-height', null);
const clipPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, '');
const containerRef = ref<HTMLElement | null>(null),
  svgRef = ref<SVGSVGElement | null>(null),
  tooltipRef = ref<HTMLElement | null>(null);
const group = ref<string | null>(null),
  selected = ref<string | null>(null);
const money = (value: number | null, currency = props.analytics.currencyCode) =>
  value == null ? 'Unavailable' : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
const rows = computed(() => investmentTreemapRows(props.analytics, props.settings));
const chartWidth = ref(0);
const height = computed(
  () => chartHeight?.value ?? Math.max(props.compact ? 300 : 380, Math.min(900, chartWidth.value * 0.8)),
);
const averages = computed(() => {
  const eligible = visible.value.filter((row) => row.change !== null);
  const gains = eligible.filter((row) => row.gain != null);
  return {
    percent: eligible.length ? eligible.reduce((n, row) => n + row.change!, 0) / eligible.length : null,
    money: gains.length ? gains.reduce((n, row) => n + row.gain!, 0) / gains.length : null,
    count: eligible.length,
  };
});
const signedMoney = (value: number | null) => (value == null ? '—' : (value >= 0 ? '+' : '') + money(value));
const total = computed(
  () =>
    props.analytics.performanceTotals?.[
      usesCustomPositionPeriod(props.settings, String(props.settings.colorBy))
        ? 'custom'
        : String(props.settings.colorBy ?? 'unrealized')
    ],
);
watch(
  () => [props.settings.grouping, props.settings.holdingsMode],
  () => {
    group.value = null;
    selected.value = null;
  },
);
const showSmall = ref(false);
const visible = computed(() => {
  const all = rows.value.filter((row) => row.size > 0 && (!group.value || row.group === group.value));
  const total = all.reduce((sum, row) => sum + row.size, 0);
  const small = all.filter((row) => row.size < total * 0.005);
  if (showSmall.value) return small;
  if (small.length < 2) return all;
  const size = small.reduce((sum, row) => sum + row.size, 0);
  return [
    ...all.filter((row) => !small.includes(row)),
    {
      ...small[0]!,
      id: '__other__',
      symbol: 'Other',
      name: small.length + ' small holdings',
      size,
      value: small.reduce((sum, row) => sum + (row.value ?? 0), 0),
      change: small.every((row) => row.change !== null)
        ? small.reduce((sum, row) => sum + row.change! * row.size, 0) / size
        : null,
      gain: small.every((row) => row.gain != null) ? small.reduce((sum, row) => sum + row.gain!, 0) : null,
      description: 'Select to explore the smaller holdings.',
      weight: total ? (size / total) * 100 : null,
    },
  ];
});
const tooltip = reactive({ visible: false, x: 0, y: 0, row: null as (typeof rows.value)[number] | null });
const { updateTooltipPosition, isChartScrolling } = useChartTooltipPosition({
  containerRef,
  tooltipRef,
  tooltip,
  strategy: 'fixed',
  onDismiss: () => {
    selected.value = null;
    d3.select(svgRef.value).selectAll('rect').attr('opacity', 1);
  },
});
function render() {
  if (!containerRef.value || !svgRef.value) return;
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();
  const width = containerRef.value.clientWidth,
    height = containerRef.value.clientHeight;
  const grouped = props.settings.grouping && props.settings.grouping !== 'security' && !group.value;
  const groups = [...d3.group(visible.value, (row) => (grouped ? row.group : 'Holdings'))];
  type TreeNode = { name: string; children?: TreeNode[]; row?: (typeof rows.value)[number]; size?: number };
  const root = d3
    .hierarchy<TreeNode>({
      name: 'Portfolio',
      children: groups.map(([name, holdings]) => ({
        name,
        children: holdings.map((row) => ({ name: row.symbol, row, size: row.size })),
      })),
    })
    .sum((node) => node.size ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const tree = d3
    .treemap<TreeNode>()
    .size([width, height])
    .paddingInner(3)
    .paddingOuter(2)
    .paddingTop(grouped ? 17 : 2)(root);
  if (grouped)
    svg
      .selectAll('text.group-label')
      .data(tree.children ?? [])
      .enter()
      .append('text')
      .attr('class', 'group-label')
      .attr('x', (node) => node.x0 + 4)
      .attr('y', (node) => node.y0 + 12)
      .attr('font-size', 10)
      .attr('fill', 'var(--muted-foreground)')
      .text((node) => node.data.name);
  const cells = svg
    .selectAll('g.cell')
    .data(tree.leaves())
    .enter()
    .append('g')
    .attr('class', 'cell')
    .attr('transform', (node) => `translate(${node.x0},${node.y0})`);
  cells
    .append('clipPath')
    .attr('id', (_node, index) => `${clipPrefix}-cell-${index}`)
    .append('rect')
    .attr('width', (node) => Math.max(0, node.x1 - node.x0 - 4))
    .attr('height', (node) => Math.max(0, node.y1 - node.y0));
  cells.attr('clip-path', (_node, index) => `url(#${clipPrefix}-cell-${index})`);
  cells
    .append('rect')
    .attr('width', (node) => Math.max(0, node.x1 - node.x0))
    .attr('height', (node) => Math.max(0, node.y1 - node.y0))
    .attr('rx', 3)
    .attr('data-security-id', (node) => node.data.row!.id)
    .attr('fill', (node) =>
      node.data.row!.change == null
        ? 'var(--muted)'
        : node.data.row!.change! >= 0
          ? 'var(--app-income-color)'
          : 'var(--app-expense-color)',
    )
    .attr('role', 'button')
    .attr('tabindex', 0)
    .attr('aria-label', (node) => `${node.data.row!.symbol}: ${money(node.data.row!.value)}`)
    .on('pointermove', (event: PointerEvent, node) => {
      if (event.pointerType !== 'touch') inspect(event, node.data.row!);
    })
    .on('pointerup', (event: PointerEvent, node) => {
      if (event.pointerType === 'touch') inspect(event, node.data.row!);
    })
    .on('pointerleave', (event: PointerEvent) => {
      if (event.pointerType !== 'touch') tooltip.visible = false;
    })
    .on('click', (_event, node) => {
      if (node.data.row!.id === '__other__') {
        showSmall.value = true;
        return;
      }
      if (grouped) group.value = node.data.row!.group;
      else selected.value = node.data.row!.id;
    })
    .on('keydown', (event: KeyboardEvent, node) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (grouped) group.value = node.data.row!.group;
        else selected.value = node.data.row!.id;
      }
    });
  cells
    .filter((node) => node.x1 - node.x0 > 46 && node.y1 - node.y0 > 28)
    .append('text')
    .attr('x', 6)
    .attr('y', 17)
    .attr('font-size', 11)
    .attr('font-weight', 650)
    .attr('fill', 'var(--foreground)')
    .attr('stroke', 'var(--card)')
    .attr('stroke-width', 2)
    .attr('paint-order', 'stroke')
    .attr('pointer-events', 'none')
    .text((node) => node.data.row!.symbol);
  cells
    .filter((node) => node.x1 - node.x0 > 64 && node.y1 - node.y0 > 48)
    .append('text')
    .attr('x', 6)
    .attr('y', 34)
    .attr('font-size', 10)
    .attr('fill', 'var(--foreground)')
    .attr('stroke', 'var(--card)')
    .attr('stroke-width', 2)
    .attr('paint-order', 'stroke')
    .attr('pointer-events', 'none')
    .text((node) => (node.data.row!.change == null ? 'No return data' : `${node.data.row!.change!.toFixed(1)}%`));
}
function inspect(event: PointerEvent, row: (typeof rows.value)[number]) {
  if (isChartScrolling()) return;
  tooltip.row = row;
  tooltip.visible = true;
  updateTooltipPosition(event);
}
useResizeObserver(containerRef, ([entry]) => {
  chartWidth.value = entry?.contentRect.width ?? 0;
  nextTick(render);
});
watch([visible, () => props.settings], () => nextTick(render), { deep: true });
</script>
<template>
  <div class="min-w-0">
    <div
      class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums"
      data-testid="treemap-range-total"
    >
      <span class="text-muted-foreground">Total holdings</span
      ><strong :class="Number(total?.gain ?? 0) >= 0 ? 'text-app-income-color' : 'text-app-expense-color'">{{
        signedMoney(total?.gain == null ? null : Number(total.gain))
      }}</strong
      ><strong :class="Number(total?.percent ?? 0) >= 0 ? 'text-app-income-color' : 'text-app-expense-color'">{{
        total?.percent == null ? '—' : (Number(total.percent) >= 0 ? '+' : '') + Number(total.percent).toFixed(2) + '%'
      }}</strong
      ><span v-if="total && total.covered < total.total" class="text-muted-foreground text-xs"
        >{{ total.covered }}/{{ total.total }} positions</span
      >
    </div>
    <div
      class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums"
      data-testid="treemap-range-summary"
    >
      <span class="text-muted-foreground">Avg holding</span>
      <strong
        :class="
          averages.money == null
            ? 'text-muted-foreground'
            : averages.money >= 0
              ? 'text-app-income-color'
              : 'text-app-expense-color'
        "
        >{{ signedMoney(averages.money) }}</strong
      >
      <strong
        :class="
          averages.percent == null
            ? 'text-muted-foreground'
            : averages.percent >= 0
              ? 'text-app-income-color'
              : 'text-app-expense-color'
        "
        >{{
          averages.percent == null ? '—' : (averages.percent >= 0 ? '+' : '') + averages.percent.toFixed(2) + '%'
        }}</strong
      >
      <span class="text-muted-foreground ml-auto inline-flex items-center gap-1"
        ><i class="bg-app-income-color size-2 rounded-sm" />Gain
        <i class="bg-app-expense-color ml-2 size-2 rounded-sm" />Loss
        <span v-if="averages.count < visible.length"> · {{ averages.count }}/{{ visible.length }}</span></span
      >
    </div>
    <button v-if="showSmall" type="button" class="text-primary-text mb-2 text-xs underline" @click="showSmall = false">
      All holdings / Small holdings ?
    </button>
    <button v-if="group" type="button" class="text-primary-text mb-2 text-xs underline" @click="group = null">
      All holdings / {{ group }} ×
    </button>
    <div ref="containerRef" class="relative w-full" :style="{ height: height + 'px' }">
      <svg ref="svgRef" class="h-full w-full" aria-label="Personal portfolio holdings treemap" />
      <Teleport to="body"
        ><div
          v-show="tooltip.visible"
          ref="tooltipRef"
          class="pointer-events-none fixed z-(--z-dialog) max-w-[calc(100vw-1rem)]"
          :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
        >
          <ChartTooltip
            ><ChartTooltipHeader>{{ tooltip.row?.symbol }} · {{ tooltip.row?.name }}</ChartTooltipHeader
            ><ChartTooltipRow label="Market value" :value="money(tooltip.row?.value ?? null)" /><ChartTooltipRow
              label="Portfolio weight"
              :value="tooltip.row?.weight == null ? 'Unknown' : tooltip.row.weight.toFixed(2) + '%'"
            /><ChartTooltipRow
              label="Selected gain / loss"
              :value="signedMoney(tooltip.row?.gain ?? null)"
            /><ChartTooltipRow
              label="Selected return"
              :value="tooltip.row?.change == null ? 'Unavailable' : tooltip.row.change.toFixed(2) + '%'"
            />
            <p class="text-card-tooltip-muted mt-2 max-w-64 text-xs">
              {{ tooltip.row?.description }}<br />{{ tooltip.row?.asOf ?? 'Source date unavailable' }}
            </p></ChartTooltip
          >
        </div></Teleport
      >
      <p
        v-if="!visible.length"
        class="text-muted-foreground absolute inset-0 flex items-center justify-center px-6 text-center text-sm"
      >
        No valued positions support this sizing mode.
      </p>
    </div>
    <p v-if="settings.holdingsMode === 'underlying'" class="text-muted-foreground mt-1 text-xs">
      Fund composition coverage {{ Number(analytics.coverage.lookThroughPercent).toFixed(2) }}% · effective dates
      {{ analytics.coverage.compositionDates?.join(', ') || 'unavailable' }}. Area represents positive exposures; signed
      derivatives and liabilities are listed in Company Exposure.
    </p>
    <p v-if="selected" class="bg-muted mt-2 rounded-md p-3 text-xs">
      {{ rows.find((row) => row.id === selected)?.name }} · {{ rows.find((row) => row.id === selected)?.description
      }}<button class="text-primary-text ml-2 underline" @click="selected = null">Close</button>
    </p>
  </div>
</template>
