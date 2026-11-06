<script setup lang="ts">
import { currentTheme } from '@/common/utils/color-theme';
import { ChartTooltip, ChartTooltipHeader, ChartTooltipRow } from '@/components/common/charts/chart-tooltip';
import { getChartColors } from '@/composable/charts/chart-colors';
import { formatAxisCurrency } from '@/composable/charts/format-axis-currency';
import { useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { computed, nextTick, onMounted, reactive, ref, useId, watch } from 'vue';
import { chartTooltipPosition, stackedUpperBoundary } from './chart-geometry';

export interface ChartRow {
  label: string;
  values: Record<string, number | null>;
  partial?: boolean;
}
export interface ChartSeries {
  id: string;
  name: string;
  color: string;
  lineOnly?: boolean;
}
const props = withDefaults(
  defineProps<{
    rows: ChartRow[];
    series: ChartSeries[];
    mode?: 'line' | 'overlay' | 'stacked' | 'bar' | 'donut';
    percentage?: boolean;
    currency?: string;
  }>(),
  { mode: 'line', percentage: false, currency: 'USD' },
);
const emit = defineEmits<{ select: [row: ChartRow] }>();
const container = ref<HTMLDivElement | null>(null);
const svg = ref<SVGSVGElement | null>(null);
const tooltipElement = ref<HTMLDivElement | null>(null);
const width = ref(700);
const gradientNamespace = useId().replace(/:/g, '');
const hiddenSeries = ref<string[]>([]);
const visibleSeries = computed(() => props.series.filter((s) => !hiddenSeries.value.includes(s.id)));
function toggleSeries(id: string) {
  hiddenSeries.value = hiddenSeries.value.includes(id)
    ? hiddenSeries.value.filter((key) => key !== id)
    : [...hiddenSeries.value, id];
}
const tooltip = reactive({ visible: false, x: 0, y: 0, row: null as ChartRow | null });
const formatValue = (n: number) =>
  props.percentage
    ? `${n.toFixed(2)}%`
    : new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: props.currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
const hasValues = computed(() =>
  props.rows.some((r) => visibleSeries.value.some((s) => r.values[s.id] !== null && r.values[s.id] !== undefined)),
);

function positionTooltip(anchor: { x: number; y: number }) {
  const bounds = container.value?.getBoundingClientRect();
  const measured = tooltipElement.value?.getBoundingClientRect();
  if (!bounds || !measured) return;
  Object.assign(
    tooltip,
    chartTooltipPosition({
      anchor,
      container: bounds,
      tooltip: measured,
      viewport: { width: innerWidth, height: innerHeight },
    }),
  );
}
function showTooltip(event: MouseEvent, row: ChartRow) {
  const bounds = container.value!.getBoundingClientRect();
  const anchor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  tooltip.row = row;
  tooltip.visible = true;
  void nextTick(() => positionTooltip(anchor));
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
    const data = visibleSeries.value
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
      .on('pointermove', (event) => showTooltip(event, row))
      .on('pointerdown', (event) => showTooltip(event, row))
      .on('click', () => emit('select', row))
      .on('pointerleave', (event: PointerEvent) => {
        if (event.pointerType !== 'touch') tooltip.visible = false;
      });
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
          visibleSeries.value.reduce((n, s) => n + Math.max(0, r.values[s.id] ?? 0), 0),
          visibleSeries.value.reduce((n, s) => n + Math.min(0, r.values[s.id] ?? 0), 0),
        ]
      : visibleSeries.value.map((s) => r.values[s.id]).filter((v): v is number => v !== null && v !== undefined),
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
    .call((g) => g.selectAll('line').attr('stroke', colors.grid).attr('stroke-opacity', 0.4));
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
      .keys(visibleSeries.value.map((s) => s.id))
      .value((r, id) => r.values[id] ?? 0)
      .offset(d3.stackOffsetDiverging);
    const area = d3
      .area<d3.SeriesPoint<ChartRow>>()
      .x((d) => x(d.data.label)!)
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]));
    plot
      .selectAll('.area')
      .data(stack(props.rows))
      .join('path')
      .attr('d', (series) => area.defined((point) => typeof point.data.values[series.key] === 'number')(series))
      .attr('fill', (s) => visibleSeries.value.find((v) => v.id === s.key)!.color)
      .attr('fill-opacity', 0.75);
  } else if (props.mode === 'bar') {
    const barW = Math.min(48, (plotW / Math.max(1, props.rows.length)) * 0.65);
    visibleSeries.value.forEach((series, seriesIndex) => {
      plot
        .selectAll(`.bar-${seriesIndex}`)
        .data(props.rows.filter((r) => r.values[series.id] !== null && r.values[series.id] !== undefined))
        .join('rect')
        .attr('x', (r) => x(r.label)! - barW / 2 + (seriesIndex * barW) / visibleSeries.value.length)
        .attr('width', barW / visibleSeries.value.length)
        .attr('y', (r) => y(Math.max(0, r.values[series.id]!)))
        .attr('height', (r) => Math.max(1, Math.abs(y(r.values[series.id]!) - y(0))))
        .attr('fill', (r) => (r.values[series.id]! < 0 ? colors.appExpense : series.color))
        .attr('rx', 2);
    });
  } else {
    const definitions = root.append('defs');
    const curve = props.rows.some((row) => row.partial) ? d3.curveLinear : d3.curveMonotoneX;
    visibleSeries.value.forEach((series, index) => {
      const available = (r: ChartRow) => r.values[series.id] !== null && r.values[series.id] !== undefined;
      const line = d3
        .line<ChartRow>()
        .curve(curve)
        .x((r) => x(r.label))
        .y((r) => y(r.values[series.id]!));
      if (!series.lineOnly) {
        const gradientId = `finance-area-${gradientNamespace}-${index}`;
        const gradient = definitions
          .append('linearGradient')
          .attr('id', gradientId)
          .attr('x1', '0%')
          .attr('y1', '0%')
          .attr('x2', '0%')
          .attr('y2', '100%');
        gradient
          .append('stop')
          .attr('offset', '0%')
          .attr('stop-color', series.color)
          .attr('stop-opacity', props.mode === 'overlay' ? 0.22 : 0.35);
        gradient.append('stop').attr('offset', '100%').attr('stop-color', series.color).attr('stop-opacity', 0);
        plot
          .append('path')
          .datum(props.rows)
          .attr(
            'd',
            d3
              .area<ChartRow>()
              .curve(curve)
              .defined(available)
              .x((r) => x(r.label))
              .y0(y(0))
              .y1((r) => y(r.values[series.id]!)),
          )
          .attr('data-testid', 'finance-history-shading')
          .attr('fill', `url(#${gradientId})`);
      }
      plot
        .append('path')
        .datum(props.rows)
        .attr(
          'd',
          line.defined((r) => available(r) && !r.partial),
        )
        .attr('fill', 'none')
        .attr('stroke', series.color)
        .attr('stroke-width', 2.5);
      plot
        .selectAll(`.partial-segment-${visibleSeries.value.indexOf(series)}`)
        .data(
          props.rows
            .slice(1)
            .map((r, i) => [props.rows[i]!, r])
            .filter((pair) => pair.every(available) && pair.some((r) => r.partial)),
        )
        .join('path')
        .attr('class', 'partial-segment')
        .attr('d', (pair) => line.defined(available)(pair))
        .attr('fill', 'none')
        .attr('stroke', series.color)
        .attr('stroke-width', 2.5)
        .attr('stroke-dasharray', '5 4');
      if (props.rows.length <= 70)
        plot
          .selectAll(`circle.series-${series.id}`)
          .data(props.rows.filter((r) => r.values[series.id] !== null && r.values[series.id] !== undefined))
          .join('circle')
          .attr('cx', (r) => x(r.label)!)
          .attr('cy', (r) => y(r.values[series.id]!))
          .attr('r', (r) => (r.partial ? 4 : 3))
          .attr('fill', (r) => (r.partial ? colors.card : series.color))
          .attr('stroke', series.color)
          .attr('stroke-width', 1.5)
          .attr('data-recorded-date', (r) => r.label)
          .attr('data-partial', (r) => String(Boolean(r.partial)));
    });
  }
  const hover = plot.append('g').attr('pointer-events', 'none').attr('display', 'none');
  const guide = hover
    .append('line')
    .attr('data-testid', 'finance-hover-guide')
    .attr('y1', 0)
    .attr('y2', plotH)
    .attr('stroke', colors.foreground)
    .attr('stroke-opacity', 0.7)
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '4 3');
  function activate(row: ChartRow, event?: PointerEvent) {
    hover.attr('display', null);
    guide.attr('x1', x(row.label)).attr('x2', x(row.label));
    hover
      .selectAll('circle')
      .data(visibleSeries.value.filter((s) => typeof row.values[s.id] === 'number'))
      .join('circle')
      .attr('cx', x(row.label))
      .attr('cy', (s) =>
        y(
          props.mode === 'stacked'
            ? stackedUpperBoundary(
                row.values,
                visibleSeries.value.map((item) => item.id),
                s.id,
              )!
            : row.values[s.id]!,
        ),
      )
      .attr('data-hover-series', (s) => s.id)
      .attr('data-hover-value', (s) => row.values[s.id]!)
      .attr('data-plotted-value', (s) =>
        props.mode === 'stacked'
          ? stackedUpperBoundary(
              row.values,
              visibleSeries.value.map((item) => item.id),
              s.id,
            )!
          : row.values[s.id]!,
      )
      .attr('r', 5)
      .attr('fill', colors.card)
      .attr('stroke', (s) => s.color)
      .attr('stroke-width', 2);
    if (event) showTooltip(event, row);
    else {
      tooltip.row = row;
      tooltip.visible = true;
      void nextTick(() => positionTooltip({ x: x(row.label) + margin.left, y: plotH / 2 }));
    }
  }
  function dismiss() {
    tooltip.visible = false;
    hover.attr('display', 'none');
  }
  function nearest(event: PointerEvent): ChartRow {
    const [px] = d3.pointer(event, plot.node());
    return props.rows.reduce(
      (best, row) => (Math.abs(x(row.label) - px) < Math.abs(x(best.label) - px) ? row : best),
      props.rows[0]!,
    );
  }
  const hitW = Math.max(8, plotW / Math.max(1, props.rows.length));
  let touch: { id: number; x: number; y: number; mode: 'pending' | 'inspect' | 'scroll' } | null = null;
  let suppressClickUntil = 0;
  plot
    .selectAll('.hit')
    .data(props.rows)
    .join('rect')
    .attr('x', (r) => x(r.label)! - hitW / 2)
    .attr('y', 0)
    .attr('width', hitW)
    .attr('height', plotH)
    .attr('fill', 'transparent')
    .attr('pointer-events', 'none')
    .attr('tabindex', 0)
    .attr(
      'aria-label',
      (r) =>
        `${r.label}: ${visibleSeries.value.map((s) => `${s.name} ${r.values[s.id] === null ? 'missing' : formatValue(r.values[s.id] ?? 0)}`).join(', ')}`,
    )
    .on('focus', (_, row) => activate(row))
    .on('keydown', (event: KeyboardEvent, row) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        emit('select', row);
      }
    })
    .on('blur', dismiss);
  plot
    .append('rect')
    .attr('class', 'chart-interaction-surface')
    .attr('data-testid', 'finance-chart-surface')
    .attr('width', plotW)
    .attr('height', plotH)
    .attr('fill', 'transparent')
    .attr('cursor', 'crosshair')
    .style('touch-action', 'pan-y pinch-zoom')
    .attr('aria-hidden', 'true')
    .on('pointermove', (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return activate(nearest(event), event);
      if (!touch || touch.id !== event.pointerId) return;
      const dx = Math.abs(event.clientX - touch.x),
        dy = Math.abs(event.clientY - touch.y);
      if (touch.mode === 'pending' && Math.max(dx, dy) > 8) {
        touch.mode = dx > dy ? 'inspect' : 'scroll';
        if (touch.mode === 'inspect') (event.currentTarget as SVGRectElement).setPointerCapture(event.pointerId);
      }
      if (touch.mode === 'scroll') return dismiss();
      activate(nearest(event), event);
    })
    .on('pointerdown', (event: PointerEvent) => {
      if (event.pointerType === 'touch')
        touch = { id: event.pointerId, x: event.clientX, y: event.clientY, mode: 'pending' };
      activate(nearest(event), event);
    })
    .on('pointerup', (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !touch || touch.id !== event.pointerId) return;
      suppressClickUntil = performance.now() + 700;
      if (touch.mode !== 'scroll') {
        activate(nearest(event), event);
        // A tap opens dated details; a drag leaves the selected value visible.
        if (touch.mode === 'pending') emit('select', nearest(event));
      }
      touch = null;
    })
    .on('pointercancel', () => {
      touch = null;
      dismiss();
    })
    .on('pointerleave', (event: PointerEvent) => {
      if (event.pointerType !== 'touch') dismiss();
    })
    .on('click', (event: PointerEvent) => {
      if (event.pointerType !== 'touch' && performance.now() >= suppressClickUntil) emit('select', nearest(event));
    });
}
useResizeObserver(container, (entries) => {
  width.value = entries[0]!.contentRect.width;
  render();
});
watch(
  () => [
    props.rows,
    props.series,
    props.mode,
    props.percentage,
    props.currency,
    currentTheme.value,
    hiddenSeries.value,
  ],
  render,
  {
    deep: true,
    flush: 'post',
  },
);
onMounted(render);
</script>

<template>
  <div>
    <div v-if="!hasValues" class="text-muted-foreground flex h-72 items-center justify-center text-sm">
      No recorded values in this period.
    </div>
    <div v-else ref="container" class="relative h-75 w-full" style="touch-action: pan-y pinch-zoom">
      <svg
        ref="svg"
        class="h-full w-full"
        style="touch-action: pan-y pinch-zoom"
        role="img"
        aria-label="Financial history chart"
      />
      <div
        v-if="tooltip.visible && tooltip.row"
        ref="tooltipElement"
        data-testid="finance-chart-tooltip"
        class="pointer-events-none absolute z-20"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px`, width: `${Math.min(288, width - 8)}px` }"
      >
        <ChartTooltip class="w-full min-w-0">
          <ChartTooltipHeader>{{ tooltip.row.label }}</ChartTooltipHeader>
          <ChartTooltipRow
            v-for="series in visibleSeries"
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
            Partial snapshot · subtotal of recorded balances; missing accounts are excluded
          </p>
        </ChartTooltip>
      </div>
    </div>
    <div class="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs">
      <span v-if="rows.some((row) => row.partial)" class="text-warning-text"
        >○ Dashed / open points: partial recorded subtotal</span
      >
      <button
        v-for="series in props.series"
        :key="series.id"
        type="button"
        :aria-pressed="!hiddenSeries.includes(series.id)"
        :aria-label="`Toggle ${series.name}`"
        @click="toggleSeries(series.id)"
        :class="[
          'text-muted-foreground flex min-h-11 items-center gap-2 px-1 sm:min-h-0',
          hiddenSeries.includes(series.id) && 'opacity-40',
        ]"
      >
        <span class="size-2.5 rounded-sm" :style="{ backgroundColor: series.color }" />{{ series.name }}
      </button>
    </div>
  </div>
</template>
