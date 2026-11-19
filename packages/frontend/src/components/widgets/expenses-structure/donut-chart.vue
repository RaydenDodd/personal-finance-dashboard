<template>
  <div ref="chartContainerRef" class="relative w-full" :class="heightClass">
    <svg ref="svgRef" class="h-full w-full" role="img" :aria-label="chartLabel"></svg>

    <!-- Center label: shows Total by default, category info on hover -->
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div class="flex flex-col items-center gap-0.5 text-center">
        <template v-if="centerLabel.isHovering">
          <div class="text-muted-foreground text-xs">{{ centerLabel.name }}</div>
          <div class="text-base font-semibold">{{ centerLabel.amount }}</div>
          <div v-if="showPercentages" class="text-muted-foreground text-xs">{{ centerLabel.percent }}</div>
        </template>
        <template v-else>
          <div class="text-muted-foreground text-xs">{{ totalLabel ?? $t('common.labels.total') }}</div>
          <div class="text-base font-semibold">{{ formatBaseCurrency(totalAmount) }}</div>
        </template>
      </div>
    </div>

    <!-- Touch device overlay: shows navigation button below center label -->
    <div
      v-if="selectionMode === 'navigate' && isTouch && selectedCategoryId !== null"
      class="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <div class="pointer-events-auto mt-18 flex flex-col items-center">
        <Button
          size="sm"
          variant="outline"
          class="h-6 gap-1 px-2 text-xs"
          @click="$emit('category-click', { categoryId: selectedCategoryId })"
        >
          {{ $t('dashboard.widgets.expensesStructure.viewButton') }}
          <ExternalLinkIcon class="size-3" />
        </Button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import Button from '@/components/lib/ui/button/Button.vue';
import { useFormatCurrency } from '@/composable';
import { useMediaQuery, useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { ExternalLinkIcon } from '@lucide/vue';
import { nextTick, reactive, ref, watch } from 'vue';

import type { ChartDataItem } from './use-expenses-structure-data';

const props = withDefaults(
  defineProps<{
    data: ChartDataItem[];
    totalAmount: number;
    totalLabel?: string;
    chartLabel?: string;
    showPercentages?: boolean;
    selectionMode?: 'navigate' | 'highlight';
    heightClass?: string;
  }>(),
  { selectionMode: 'navigate', showPercentages: false, heightClass: 'h-55', chartLabel: 'Expense structure' },
);

const emit = defineEmits<{
  'category-click': [payload: { categoryId: string }];
}>();

const { formatBaseCurrency } = useFormatCurrency();
const isTouch = useMediaQuery('(pointer: coarse)');

const chartContainerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const selectedCategoryId = ref<string | null>(null);

const centerLabel = reactive({
  name: '',
  amount: '',
  percent: '',
  isHovering: false,
});

const renderChart = () => {
  if (!svgRef.value || !chartContainerRef.value) return;

  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const width = chartContainerRef.value.clientWidth;
  const height = chartContainerRef.value.clientHeight;

  const glowSize = 10;
  const radius = Math.min(width, height) / 2 - glowSize;
  const innerRadius = radius * 0.7;

  const pie = d3
    .pie<ChartDataItem>()
    .value((d) => d.amount)
    .sort(null);

  const arc = d3.arc<d3.PieArcDatum<ChartDataItem>>().innerRadius(innerRadius).outerRadius(radius);

  const glowArc = d3
    .arc<d3.PieArcDatum<ChartDataItem>>()
    .innerRadius(radius)
    .outerRadius(radius + glowSize);

  const g = svg.append('g').attr('transform', `translate(${width / 2},${height / 2})`);
  const glowGroup = g.append('g').attr('class', 'glow-group');
  const pieData = pie(props.data);
  const arcs = g.selectAll('.arc').data(pieData).enter().append('g').attr('class', 'arc');

  const highlight = (id: string | null) => {
    const datum = pieData.find((d) => d.data.categoryId === id);
    arcs
      .selectAll<SVGPathElement, d3.PieArcDatum<ChartDataItem>>('path')
      .style('opacity', (d) => (!datum || d.data.categoryId === id ? 1 : 0.3));
    glowGroup.selectAll('*').remove();
    if (datum) {
      glowGroup.append('path').attr('d', glowArc(datum)).attr('fill', datum.data.color).style('opacity', 0.5);
      centerLabel.name = datum.data.name;
      centerLabel.amount = formatBaseCurrency(datum.data.amount);
      centerLabel.percent = `${((datum.data.amount / props.totalAmount) * 100).toFixed(1)}%`;
    }
    centerLabel.isHovering = !!datum;
  };
  const select = (d: d3.PieArcDatum<ChartDataItem>) => {
    if (props.selectionMode === 'highlight' || isTouch.value) {
      selectedCategoryId.value = d.data.categoryId;
      highlight(d.data.categoryId);
    }
    if (props.selectionMode === 'highlight' || !isTouch.value)
      emit('category-click', { categoryId: d.data.categoryId });
  };
  arcs
    .append('path')
    .attr('d', arc)
    .attr('fill', (d) => d.data.color)
    .attr('stroke', 'var(--card)')
    .attr('stroke-width', 2)
    .attr('data-category-id', (d) => d.data.categoryId)
    .attr('role', 'button')
    .attr('tabindex', 0)
    .attr('aria-label', (d) => `${d.data.name} ${((d.data.amount / props.totalAmount) * 100).toFixed(1)}%`)
    .style('outline', 'none')
    .style('cursor', 'pointer')
    .style('transition', 'opacity 0.2s ease')
    .on('mouseenter focus', (_event, d) => {
      if (!isTouch.value) highlight(d.data.categoryId);
    })
    .on('mouseleave blur', () => highlight(props.selectionMode === 'highlight' ? selectedCategoryId.value : null))
    .on('click', (_event, d) => select(d))
    .on('keydown', (event: KeyboardEvent, d) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select(d);
      }
    });
  if (props.showPercentages && props.totalAmount > 0) {
    arcs
      .filter((d) => d.endAngle - d.startAngle > 0.16)
      .append('text')
      .attr('transform', (d) => `translate(${arc.centroid(d)})`)
      .attr('text-anchor', 'middle')
      .attr('dy', '.35em')
      .attr('fill', '#fff')
      .attr('stroke', '#171717')
      .attr('stroke-width', 2.5)
      .attr('stroke-linejoin', 'round')
      .attr('paint-order', 'stroke')
      .attr('font-size', 12)
      .attr('font-weight', 650)
      .attr('pointer-events', 'none')
      .text((d) => `${((d.data.amount / props.totalAmount) * 100).toFixed(1)}%`);
  }
  highlight(props.selectionMode === 'highlight' ? selectedCategoryId.value : null);
};

// Watch for touch selection changes to update opacity
watch(selectedCategoryId, (newId) => {
  if (!svgRef.value || !newId) {
    const svg = d3.select(svgRef.value);
    svg.selectAll('.arc path').style('opacity', 1);
    svg.selectAll('.glow-group *').remove();
    if (!newId) {
      centerLabel.isHovering = false;
    }
  }
});

useResizeObserver(chartContainerRef, renderChart);

watch(
  [() => props.data, () => props.totalAmount, chartContainerRef],
  async ([, , container]) => {
    if (container) {
      await nextTick();
      renderChart();
    }
  },
  { immediate: true, deep: true },
);

// Clear selection when data changes (period changed)
watch(
  () => props.data,
  () => {
    selectedCategoryId.value = null;
    centerLabel.isHovering = false;
  },
);
</script>
