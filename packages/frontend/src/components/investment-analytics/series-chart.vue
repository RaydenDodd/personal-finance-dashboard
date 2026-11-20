<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { ChartTooltip, ChartTooltipHeader, ChartTooltipRow } from '@/components/common/charts/chart-tooltip';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { nearestChartPoint } from '@/composable/charts/chart-hit-testing';
import { currentTheme } from '@/common/utils/color-theme';
import { useFormatCurrency } from '@/composable/formatters';
import type { InvestmentChartEvent, InvestmentChartPoint, InvestmentChartSeries } from './chart-model';

const props = withDefaults(
  defineProps<{
    points: InvestmentChartPoint[];
    series: InvestmentChartSeries[];
    events?: InvestmentChartEvent[];
    percent?: boolean;
    bars?: boolean;
    compact?: boolean;
    label?: string;
    shareLabel?: string;
  }>(),
  { events: () => [], label: 'Investment history', shareLabel: 'period income' },
);
const containerRef = ref<HTMLElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLElement | null>(null);
const hidden = ref<string[]>([]);
const visibleSeries = computed(() => props.series.filter((series) => !hidden.value.includes(series.key)));
const tooltipSeries = computed(() =>
  props.bars ? visibleSeries.value.filter((series) => series.key === tooltip.segment) : visibleSeries.value,
);
const tooltip = reactive({ visible: false, x: 0, y: 0, point: null as InvestmentChartPoint | null, segment: '' });
const { formatBaseCurrency } = useFormatCurrency();
const formatValue = (value: number | null | undefined) =>
  value == null ? 'Unavailable' : props.percent ? `${value.toFixed(2)}%` : formatBaseCurrency(value);
let clear = () => {};
const { updateTooltipPosition, isChartScrolling } = useChartTooltipPosition({
  containerRef,
  tooltipRef,
  tooltip,
  onDismiss: () => clear(),
});
function render() {
  if (!containerRef.value || !svgRef.value) return;
  tooltip.visible = false;
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();
  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  if (!width || !height || !props.points.length) return;
  const margin = { top: 16, right: 12, bottom: 30, left: width < 450 ? 48 : 68 };
  const w = Math.max(1, width - margin.left - margin.right),
    h = height - margin.top - margin.bottom;
  const points = [...props.points].sort((a, b) => a.date.localeCompare(b.date));
  const dates = points.map((point) => new Date(`${point.date.slice(0, 10)}T12:00:00Z`));
  let [minDate, maxDate] = d3.extent(dates) as [Date, Date];
  if (+minDate === +maxDate) {
    minDate = new Date(+minDate - 86400000);
    maxDate = new Date(+maxDate + 86400000);
  }
  const x = d3.scaleTime().domain([minDate, maxDate]).range([0, w]);
  const value = (point: InvestmentChartPoint, key: string) => point.values[key];
  const values = points.flatMap((point) =>
    props.bars
      ? [
          visibleSeries.value.reduce((sum, series) => sum + Math.max(0, value(point, series.key) ?? 0), 0),
          visibleSeries.value.reduce((sum, series) => sum + Math.min(0, value(point, series.key) ?? 0), 0),
        ]
      : visibleSeries.value.map((series) => value(point, series.key)).filter((v): v is number => v != null),
  );
  const low = Math.min(0, d3.min(values) ?? 0),
    high = Math.max(0, d3.max(values) ?? 1);
  const y = d3
    .scaleLinear()
    .domain([low * 1.1, high > low ? high * 1.08 : high + 1])
    .nice()
    .range([h, 0]);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  g.append('g')
    .call(
      d3
        .axisLeft(y)
        .ticks(4)
        .tickSize(-w)
        .tickFormat((v) => (props.percent ? `${v}%` : d3.format('~s')(Number(v)))),
    )
    .call((axis) => axis.select('.domain').remove())
    .call((axis) => axis.selectAll('line').attr('stroke', 'var(--border)').attr('stroke-dasharray', '3,4'))
    .call((axis) => axis.selectAll('text').attr('fill', 'var(--muted-foreground)').attr('font-size', 10));
  g.append('g')
    .attr('transform', `translate(0,${h})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(width < 450 ? 3 : 6)
        .tickFormat((date) => d3.timeFormat('%b %y')(date as Date)),
    )
    .call((axis) => axis.select('.domain').remove())
    .call((axis) => axis.selectAll('text').attr('fill', 'var(--muted-foreground)').attr('font-size', 10));
  const selectedBars = g.append('g');
  const barWidth = Math.min(46, Math.max(4, (w / Math.max(points.length, 1)) * 0.65));
  if (props.bars) {
    points.forEach((point) => {
      let positive = 0,
        negative = 0;
      visibleSeries.value.forEach((series) => {
        const v = value(point, series.key);
        if (v == null) return;
        const base = v >= 0 ? positive : negative;
        if (v >= 0) positive += v;
        else negative += v;
        selectedBars
          .append('rect')
          .datum({ point, series })
          .attr('data-series', series.key)
          .attr('x', x(new Date(`${point.date.slice(0, 10)}T12:00:00Z`)) - barWidth / 2)
          .attr('y', y(Math.max(base, base + v)))
          .attr('width', barWidth)
          .attr('height', Math.abs(y(base) - y(base + v)))
          .attr('fill', series.color)
          .attr('rx', 2)
          .attr('opacity', 0.85);
      });
    });
  } else {
    for (const series of visibleSeries.value) {
      const line = d3
        .line<InvestmentChartPoint>()
        .defined((point) => value(point, series.key) != null)
        .x((point) => x(new Date(`${point.date.slice(0, 10)}T12:00:00Z`)))
        .y((point) => y(value(point, series.key)!));
      g.append('path')
        .datum(points)
        .attr('d', line)
        .attr('fill', 'none')
        .attr('stroke', series.color)
        .attr('stroke-width', 2.5)
        .attr('data-series', series.key);
      if (points.length <= 62)
        g.selectAll(`.dot-${series.key.replace(/\W/g, '')}`)
          .data(points.filter((point) => value(point, series.key) != null))
          .enter()
          .append('circle')
          .attr('cx', (point) => x(new Date(`${point.date.slice(0, 10)}T12:00:00Z`)))
          .attr('cy', (point) => y(value(point, series.key)!))
          .attr('r', 2)
          .attr('fill', series.color);
    }
  }
  for (const event of props.events
    .filter((event) => event.date >= points[0]!.date && event.date <= points.at(-1)!.date)
    .slice(-18)) {
    g.append('circle')
      .attr('cx', x(new Date(`${event.date.slice(0, 10)}T12:00:00Z`)))
      .attr('cy', h - 3)
      .attr('r', 3)
      .attr('fill', 'var(--muted-foreground)')
      .append('title')
      .text(event.label);
  }
  const guide = g
    .append('line')
    .attr('data-testid', 'investment-crosshair')
    .attr('y1', 0)
    .attr('y2', h)
    .attr('stroke', 'var(--muted-foreground)')
    .attr('stroke-dasharray', '3,3')
    .attr('opacity', 0);
  const dots = g.append('g');
  clear = () => {
    guide.attr('opacity', 0);
    dots.selectAll('*').remove();
    selectedBars.selectAll('rect').attr('opacity', 0.85);
  };
  function move(event: PointerEvent | MouseEvent) {
    if (isChartScrolling()) return;
    const [px, py] = d3.pointer(event, g.node());
    const point = nearestChartPoint(
      points,
      +x.invert(Math.max(0, Math.min(px, w))),
      (p) => +new Date(`${p.date.slice(0, 10)}T12:00:00Z`),
    );
    if (!point) return;
    const cx = x(new Date(`${point.date.slice(0, 10)}T12:00:00Z`));
    guide.attr('x1', px).attr('x2', px).attr('opacity', 0.6);
    dots.selectAll('*').remove();
    visibleSeries.value.forEach((series) => {
      const v = value(point, series.key);
      if (v != null && !props.bars)
        dots
          .append('circle')
          .attr('cx', cx)
          .attr('cy', y(v))
          .attr('r', 4)
          .attr('fill', series.color)
          .attr('stroke', 'var(--card)')
          .attr('stroke-width', 2);
    });
    tooltip.point = point;
    tooltip.segment = '';
    tooltip.visible = true;
    if (props.bars) {
      const rects = selectedBars.selectAll<
        SVGRectElement,
        { point: InvestmentChartPoint; series: InvestmentChartSeries }
      >('rect');
      rects.each(function (datum) {
        if (
          datum.point === point &&
          py >= Number(this.getAttribute('y')) &&
          py <= Number(this.getAttribute('y')) + Number(this.getAttribute('height'))
        )
          tooltip.segment = datum.series.key;
      });
      rects.attr('opacity', (datum) => (datum.point === point && datum.series.key === tooltip.segment ? 1 : 0.35));
      if (!tooltip.segment) {
        tooltip.visible = false;
        clear();
        return;
      }
    }
    updateTooltipPosition(event);
  }
  g.append('rect')
    .attr('data-testid', 'investment-chart-overlay')
    .attr('width', w)
    .attr('height', h)
    .attr('fill', 'transparent')
    .style('touch-action', 'pan-y')
    .on('pointermove', (event: PointerEvent) => {
      if (event.pointerType !== 'touch') move(event);
    })
    .on('pointerup', (event: PointerEvent) => {
      if (event.pointerType === 'touch') move(event);
    })
    .on('pointerleave', (event: PointerEvent) => {
      if (event.pointerType !== 'touch') {
        tooltip.visible = false;
        clear();
      }
    });
}
useResizeObserver(containerRef, render);
watch(
  [() => props.points, visibleSeries, () => props.percent, () => props.bars, currentTheme],
  () => nextTick(render),
  { deep: true },
);
</script>
<template>
  <div class="flex min-h-0 min-w-0 flex-col">
    <div ref="containerRef" class="relative w-full" :class="compact ? 'h-52' : 'h-72'">
      <svg ref="svgRef" class="h-full w-full" role="img" :aria-label="label" />
      <div
        v-show="tooltip.visible"
        ref="tooltipRef"
        class="pointer-events-none absolute z-20 max-w-[min(22rem,90vw)]"
        :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
        data-testid="investment-chart-tooltip"
      >
        <ChartTooltip
          ><ChartTooltipHeader>{{ tooltip.point?.date }}</ChartTooltipHeader>
          <ChartTooltipRow
            v-for="series in tooltipSeries"
            :key="series.key"
            :color="series.color"
            :label="series.label"
            :value="formatValue(tooltip.point?.values[series.key])"
            :value-class="tooltip.segment === series.key ? 'font-bold' : ''"
          />
          <p v-if="bars && tooltip.segment && tooltip.point" class="text-card-tooltip-muted mt-1 text-xs">
            {{
              (
                (Math.abs(tooltip.point.values[tooltip.segment] ?? 0) /
                  Math.max(
                    1e-10,
                    visibleSeries.reduce((sum, row) => sum + Math.abs(tooltip.point?.values[row.key] ?? 0), 0),
                  )) *
                100
              ).toFixed(1)
            }}% of {{ shareLabel }}
          </p>
          <p v-if="tooltip.point?.note" class="text-card-tooltip-muted mt-2 max-w-64 text-xs">
            {{ tooltip.point.note }}
          </p>
        </ChartTooltip>
      </div>
      <p
        v-if="!points.length"
        class="text-muted-foreground absolute inset-0 flex items-center justify-center px-6 text-center text-sm"
      >
        No recorded observations in this date range.
      </p>
    </div>
    <div class="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-2" aria-label="Chart series">
      <button
        v-for="series in props.series"
        :key="series.key"
        type="button"
        class="flex items-center gap-1.5 text-xs"
        :class="hidden.includes(series.key) ? 'opacity-40' : ''"
        :aria-pressed="!hidden.includes(series.key)"
        @click="
          hidden = hidden.includes(series.key) ? hidden.filter((key) => key !== series.key) : [...hidden, series.key]
        "
      >
        <span class="h-0.5 w-4" :style="{ background: series.color }" />{{ series.label }}
      </button>
    </div>
  </div>
</template>
