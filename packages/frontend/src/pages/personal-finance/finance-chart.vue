<script setup lang="ts">
import { currentTheme } from '@/common/utils/color-theme';
import { ChartTooltip, ChartTooltipHeader, ChartTooltipRow } from '@/components/common/charts/chart-tooltip';
import { getChartColors } from '@/composable/charts/chart-colors';
import { formatAxisCurrency } from '@/composable/charts/format-axis-currency';
import { useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { computed, onMounted, reactive, ref, watch } from 'vue';

export interface ChartRow {
  label: string;
  values: Record<string, number | null>;
  partial?: boolean;
}
export interface ChartSeries {
  id: string;
  name: string;
  color: string;
}
const props = withDefaults(
  defineProps<{
    rows: ChartRow[];
    series: ChartSeries[];
    mode?: 'line' | 'stacked' | 'bar' | 'donut';
    percentage?: boolean;
    currency?: string;
  }>(),
  { mode: 'line', percentage: false, currency: 'USD' },
);
const container = ref<HTMLDivElement | null>(null);
const svg = ref<SVGSVGElement | null>(null);
const width = ref(700);
const tooltip = reactive({ visible: false, x: 0, y: 0, row: null as ChartRow | null });
const formatValue = (n: number) =>
  props.percentage
    ? `${n.toFixed(2)}%`
    : new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: props.currency,
        maximumFractionDigits: 0,
      }).format(n);
const hasValues = computed(() =>
  props.rows.some((r) => props.series.some((s) => r.values[s.id] !== null && r.values[s.id] !== undefined)),
);

function showTooltip(event: MouseEvent, row: ChartRow) {
  const bounds = container.value!.getBoundingClientRect();
  tooltip.x = Math.max(4, Math.min(event.clientX - bounds.left + 12, width.value - 235));
  tooltip.y = Math.max(4, event.clientY - bounds.top - 60);
  tooltip.row = row;
  tooltip.visible = true;
}
function render() {
  if (!svg.value || !hasValues.value) return;
  tooltip.visible = false;
  const colors = getChartColors();
  const root = d3.select(svg.value);
  root.selectAll('*').remove();
  const w = Math.max(width.value, 280),
    h = 300;
  root.attr('viewBox', `0 0 ${w} ${h}`);
  if (props.mode === 'donut') {
    const row = props.rows.at(-1)!;
    const data = props.series
      .map((s) => ({ ...s, value: Math.max(0, row.values[s.id] ?? 0) }))
      .filter((s) => s.value > 0);
    const radius = Math.min(w / 2 - 10, 130);
    const arc = d3
      .arc<d3.PieArcDatum<(typeof data)[number]>>()
      .innerRadius(radius * 0.65)
      .outerRadius(radius);
    root
      .append('g')
      .attr('transform', `translate(${w / 2},150)`)
      .selectAll('path')
      .data(
        d3
          .pie<(typeof data)[number]>()
          .value((s) => s.value)
          .sort(null)(data),
      )
      .join('path')
      .attr('d', arc)
      .attr('fill', (d) => d.data.color)
      .attr('stroke', colors.card)
      .attr('stroke-width', 3)
      .on('mousemove', (event) => showTooltip(event, row))
      .on('mouseleave', () => (tooltip.visible = false));
    root
      .append('text')
      .attr('x', w / 2)
      .attr('y', 145)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text)
      .attr('font-size', 12)
      .text('Included assets');
    root
      .append('text')
      .attr('x', w / 2)
      .attr('y', 170)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.foreground)
      .attr('font-size', 21)
      .attr('font-weight', 600)
      .text(formatValue(data.reduce((sum, s) => sum + s.value, 0)));
    return;
  }
  const margin = { top: 12, right: 12, bottom: 38, left: w < 420 ? 62 : 75 };
  const plotW = w - margin.left - margin.right,
    plotH = h - margin.top - margin.bottom;
  const plot = root.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const categoricalX = d3
    .scalePoint<string>()
    .domain(props.rows.map((r) => r.label))
    .range([0, plotW])
    .padding(0.35);
  const isDated = props.rows.every((r) => /^\d{4}-\d{2}(-\d{2})?$/.test(r.label));
  const timestamp = (label: string) => Date.parse(`${label.length === 7 ? `${label}-01` : label}T12:00:00Z`);
  const timestamps = isDated ? props.rows.map((r) => timestamp(r.label)) : [];
  const minDate = Math.min(...timestamps),
    maxDate = Math.max(...timestamps);
  const datePadding = Math.max(86400000, (maxDate - minDate) * 0.03);
  const temporalX = d3
    .scaleUtc()
    .domain([new Date(minDate - datePadding), new Date(maxDate + datePadding)])
    .range([0, plotW]);
  const x = (label: string): number => (isDated ? temporalX(new Date(timestamp(label))) : categoricalX(label)!);
  const values = props.rows.flatMap((r) =>
    props.mode === 'stacked'
      ? [
          props.series.reduce((n, s) => n + Math.max(0, r.values[s.id] ?? 0), 0),
          props.series.reduce((n, s) => n + Math.min(0, r.values[s.id] ?? 0), 0),
        ]
      : props.series.map((s) => r.values[s.id]).filter((v): v is number => v !== null && v !== undefined),
  );
  const lo = Math.min(0, d3.min(values) ?? 0),
    hi = Math.max(0, d3.max(values) ?? 1);
  const y = d3
    .scaleLinear()
    .domain([lo, hi === lo ? hi + 1 : hi])
    .nice()
    .range([plotH, 0]);
  plot
    .append('g')
    .call(
      d3
        .axisLeft(y)
        .ticks(5)
        .tickSize(-plotW)
        .tickFormat(() => ''),
    )
    .call((g) => g.select('.domain').remove())
    .call((g) => g.selectAll('line').attr('stroke', colors.grid).attr('stroke-opacity', 0.6));
  plot
    .append('g')
    .call(
      d3
        .axisLeft(y)
        .ticks(5)
        .tickSize(0)
        .tickPadding(10)
        .tickFormat((v) =>
          props.percentage
            ? `${v}%`
            : formatAxisCurrency({
                value: Number(v),
                symbol:
                  new Intl.NumberFormat(undefined, { style: 'currency', currency: props.currency })
                    .formatToParts(0)
                    .find((p) => p.type === 'currency')?.value ?? '$',
              }),
        ),
    )
    .call((g) => g.select('.domain').remove())
    .attr('color', colors.text)
    .attr('font-size', 11);
  const tickEvery = Math.max(1, Math.ceil(props.rows.length / (w < 420 ? 4 : 8)));
  const xAxis = plot.append('g').attr('transform', `translate(0,${plotH})`);
  if (isDated) {
    xAxis.call(
      d3
        .axisBottom(temporalX)
        .ticks(w < 420 ? 4 : 8)
        .tickSize(0)
        .tickPadding(14)
        .tickFormat((date) => d3.utcFormat(maxDate - minDate < 180 * 86400000 ? '%b %d' : '%b %Y')(date as Date)),
    );
  } else {
    xAxis.call(
      d3
        .axisBottom(categoricalX)
        .tickValues(props.rows.filter((_, i) => i % tickEvery === 0).map((r) => r.label))
        .tickSize(0)
        .tickPadding(14)
        .tickFormat((label) =>
          /^\d{4}-\d{2}-\d{2}$/.test(label) ? label.slice(0, 7) : label.length > 14 ? `${label.slice(0, 12)}…` : label,
        ),
    );
  }
  xAxis
    .call((g) => g.select('.domain').remove())
    .attr('color', colors.text)
    .attr('font-size', 10);
  if (props.mode === 'stacked') {
    const stack = d3
      .stack<ChartRow>()
      .keys(props.series.map((s) => s.id))
      .value((r, id) => r.values[id] ?? 0)
      .offset(d3.stackOffsetDiverging);
    const area = d3
      .area<d3.SeriesPoint<ChartRow>>()
      .x((d) => x(d.data.label)!)
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .defined((d) => props.series.every((s) => d.data.values[s.id] !== null && d.data.values[s.id] !== undefined));
    plot
      .selectAll('.area')
      .data(stack(props.rows))
      .join('path')
      .attr('d', area)
      .attr('fill', (s) => props.series.find((v) => v.id === s.key)!.color)
      .attr('fill-opacity', 0.75);
  } else if (props.mode === 'bar') {
    const barW = Math.min(48, (plotW / Math.max(1, props.rows.length)) * 0.65);
    props.series.forEach((series, seriesIndex) => {
      plot
        .selectAll(`.bar-${seriesIndex}`)
        .data(props.rows.filter((r) => r.values[series.id] !== null && r.values[series.id] !== undefined))
        .join('rect')
        .attr('x', (r) => x(r.label)! - barW / 2 + (seriesIndex * barW) / props.series.length)
        .attr('width', barW / props.series.length)
        .attr('y', (r) => y(Math.max(0, r.values[series.id]!)))
        .attr('height', (r) => Math.max(1, Math.abs(y(r.values[series.id]!) - y(0))))
        .attr('fill', (r) => (r.values[series.id]! < 0 ? colors.appExpense : series.color))
        .attr('rx', 2);
    });
  } else {
    props.series.forEach((series) => {
      plot
        .append('path')
        .datum(props.rows)
        .attr(
          'd',
          d3
            .line<ChartRow>()
            .defined((r) => r.values[series.id] !== null && r.values[series.id] !== undefined)
            .x((r) => x(r.label)!)
            .y((r) => y(r.values[series.id]!)),
        )
        .attr('fill', 'none')
        .attr('stroke', series.color)
        .attr('stroke-width', 2.5);
      if (props.rows.length <= 70)
        plot
          .selectAll(`circle.series-${series.id}`)
          .data(props.rows.filter((r) => r.values[series.id] !== null && r.values[series.id] !== undefined))
          .join('circle')
          .attr('cx', (r) => x(r.label)!)
          .attr('cy', (r) => y(r.values[series.id]!))
          .attr('r', 3)
          .attr('fill', series.color);
    });
  }
  const hitW = Math.max(8, plotW / Math.max(1, props.rows.length));
  plot
    .selectAll('.hit')
    .data(props.rows)
    .join('rect')
    .attr('x', (r) => x(r.label)! - hitW / 2)
    .attr('y', 0)
    .attr('width', hitW)
    .attr('height', plotH)
    .attr('fill', 'transparent')
    .attr('tabindex', 0)
    .attr(
      'aria-label',
      (r) =>
        `${r.label}: ${props.series.map((s) => `${s.name} ${r.values[s.id] === null ? 'missing' : formatValue(r.values[s.id] ?? 0)}`).join(', ')}`,
    )
    .on('mousemove', (event, row) => showTooltip(event, row))
    .on('mouseleave', () => (tooltip.visible = false))
    .on('focus', (_, row) => {
      tooltip.row = row;
      tooltip.x = Math.max(4, Math.min(x(row.label)!, w - 235));
      tooltip.y = 10;
      tooltip.visible = true;
    })
    .on('blur', () => (tooltip.visible = false));
}
useResizeObserver(container, (entries) => {
  width.value = entries[0]!.contentRect.width;
  render();
});
watch(() => [props.rows, props.series, props.mode, props.percentage, props.currency, currentTheme.value], render, {
  deep: true,
  flush: 'post',
});
onMounted(render);
</script>

<template>
  <div>
    <div v-if="!hasValues" class="text-muted-foreground flex h-72 items-center justify-center text-sm">
      No recorded values in this period.
    </div>
    <div v-else ref="container" class="relative h-75 w-full">
      <svg ref="svg" class="h-full w-full" role="img" aria-label="Financial history chart" />
      <div
        v-if="tooltip.visible && tooltip.row"
        class="pointer-events-none absolute z-20 max-w-60"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      >
        <ChartTooltip>
          <ChartTooltipHeader>{{ tooltip.row.label }}</ChartTooltipHeader>
          <ChartTooltipRow
            v-for="series in props.series"
            :key="series.id"
            :color="series.color"
            :label="series.name"
            :value="
              tooltip.row.values[series.id] === null || tooltip.row.values[series.id] === undefined
                ? 'Missing'
                : formatValue(tooltip.row.values[series.id]!)
            "
          />
          <p v-if="tooltip.row.partial" class="text-warning-text mt-2 text-xs">
            Partial snapshot · some balances are missing
          </p>
        </ChartTooltip>
      </div>
    </div>
    <div class="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs">
      <span v-for="series in props.series" :key="series.id" class="text-muted-foreground flex items-center gap-2"
        ><span class="size-2.5 rounded-sm" :style="{ backgroundColor: series.color }" />{{ series.name }}</span
      >
    </div>
  </div>
</template>
