<script setup lang="ts">
import type { PayrollDashboard, PayrollSalaryEvent } from '@bt/shared/types/payroll';
import { currentTheme } from '@/common/utils/color-theme';
import { Card } from '@/components/lib/ui/card';
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { SettingsIcon, ArrowUpRightIcon, ArrowDownRightIcon } from '@lucide/vue';
import {
  ChartTooltip,
  ChartTooltipHeader,
  ChartTooltipRow,
  ChartTooltipDivider,
} from '@/components/common/charts/chart-tooltip';
import { getChartColors } from '@/composable/charts/chart-colors';
import { formatAxisCurrency } from '@/composable/charts/format-axis-currency';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { nearestChartPoint } from '@/composable/charts/chart-hit-testing';
import { useLocalStorage, useResizeObserver } from '@vueuse/core';
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import * as d3 from 'd3';
import DateRange from './date-range.vue';
import { payrollRange, payrollToday, type PayrollRange } from './date-range';
import { usePayroll } from './use-payroll';
import { money } from './format';
const props = withDefaults(defineProps<{ data?: PayrollDashboard; settingsKey?: string }>(), {
  settingsKey: 'payroll:salary-history',
});
const savedRange = useLocalStorage<PayrollRange>(props.settingsKey + ':range', payrollRange('all'));
const range = ref(savedRange.value.preset === 'custom' ? savedRange.value : payrollRange(savedRange.value.preset));
watch(
  range,
  (value) => {
    savedRange.value = value;
  },
  { deep: true },
);
const employmentId = useLocalStorage(props.settingsKey + ':employment', 'all');
const query = usePayroll({ from: '1900-01-01', through: payrollToday() });
const data = computed(() => props.data ?? query.data.value);
const allEvents = computed(
  () =>
    data.value?.salaryEvents
      .filter((e) => employmentId.value === 'all' || e.employmentId === employmentId.value)
      .sort((a, b) => a.date.localeCompare(b.date)) ?? [],
);
const earliest = computed(() => allEvents.value[0]?.date ?? payrollToday());
watch(
  earliest,
  (value) => {
    if (range.value.preset === 'all' && allEvents.value.length && range.value.from !== value)
      range.value = { ...range.value, from: value };
  },
  { immediate: true },
);
const bounds = computed(() => ({
  from: range.value.preset === 'all' ? earliest.value : range.value.from,
  through: range.value.through,
}));
const containerRef = ref<HTMLElement | null>(null),
  svgRef = ref<SVGSVGElement | null>(null),
  tooltipRef = ref<HTMLElement | null>(null),
  width = ref(700);
const tooltip = reactive({ visible: false, x: 0, y: 0, date: '', events: [] as PayrollSalaryEvent[], onEvent: false });
const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip, strategy: 'fixed' });
function render() {
  if (!svgRef.value) return;
  tooltip.visible = false;
  const colors = getChartColors(),
    root = d3.select(svgRef.value),
    w = Math.max(200, width.value),
    h = w < 500 ? 250 : 300,
    m = { left: w < 400 ? 42 : 58, right: w < 400 ? 10 : 18, top: 26, bottom: 32 };
  root.selectAll('*').remove();
  root.attr('viewBox', `0 0 ${w} ${h}`);
  if (!allEvents.value.length) return;
  const start = new Date(bounds.value.from + 'T12:00:00'),
    end = new Date(bounds.value.through + 'T12:00:00');
  if (+start === +end) end.setDate(end.getDate() + 1);
  const x = d3
    .scaleTime()
    .domain([start, end])
    .range([m.left, w - m.right]);
  const visibleEvents = allEvents.value.filter((e) => e.date <= bounds.value.through);
  const salaryExtent = d3.extent(visibleEvents, (e) => e.salary) as [number, number];
  const min = salaryExtent[0] ?? 0,
    max = salaryExtent[1] ?? 1,
    padding = Math.max((max - min) * 0.15, max * 0.06, 1);
  const y = d3
    .scaleLinear()
    .domain([Math.max(0, min - padding), max + padding])
    .nice()
    .range([h - m.bottom, m.top]);
  root
    .append('g')
    .attr('transform', `translate(${m.left},0)`)
    .call(
      d3
        .axisLeft(y)
        .ticks(4)
        .tickSize(-(w - m.left - m.right))
        .tickFormat((v) => formatAxisCurrency({ value: Number(v), symbol: '$' })),
    )
    .call((g) => g.select('.domain').remove())
    .call((g) => g.selectAll('line').attr('stroke', colors.grid).attr('stroke-opacity', 0.5))
    .call((g) => g.selectAll('text').attr('fill', colors.text));
  root
    .append('g')
    .attr('transform', `translate(0,${h - m.bottom})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(w < 400 ? 2 : w < 500 ? 3 : 6)
        .tickFormat((d) =>
          d3.timeFormat(w < 400 ? (+end - +start > 730 * 86400000 ? '%Y' : '%b %y') : '%b %Y')(d as Date),
        ),
    )
    .call((g) => g.selectAll('path,line').attr('stroke', colors.grid))
    .call((g) => g.selectAll('text').attr('fill', colors.text));
  const grouped = d3.group(visibleEvents, (e) => e.employmentId);
  let region = 0;
  for (const [id, events] of grouped) {
    const employment = data.value?.employments.find((e) => e.id === id);
    const before = events.filter((e) => e.date <= bounds.value.from).at(-1);
    const points = [
      ...(before ? [{ ...before, date: bounds.value.from }] : []),
      ...events.filter((e) => e.date >= bounds.value.from),
    ];
    const last = points.at(-1);
    const through =
      employment?.endDate && employment.endDate < bounds.value.through ? employment.endDate : bounds.value.through;
    if (!last || last.date > through) continue;
    if (last.date < through) points.push({ ...last, date: through });
    const line = d3
      .line<PayrollSalaryEvent>()
      .x((e) => x(new Date(e.date + 'T12:00:00')))
      .y((e) => y(e.salary))
      .curve(d3.curveStepAfter);
    const area = d3
      .area<PayrollSalaryEvent>()
      .x((e) => x(new Date(e.date + 'T12:00:00')))
      .y0(h - m.bottom)
      .y1((e) => y(e.salary))
      .curve(d3.curveStepAfter);
    root
      .append('rect')
      .attr('x', x(new Date(points[0]!.date + 'T12:00:00')))
      .attr('y', m.top)
      .attr('width', Math.max(0, x(new Date(through + 'T12:00:00')) - x(new Date(points[0]!.date + 'T12:00:00'))))
      .attr('height', h - m.top - m.bottom)
      .attr('fill', region++ % 2 === 0 ? colors.primary : colors.appSavings)
      .attr('opacity', 0.025);
    root.append('path').datum(points).attr('d', area).attr('fill', colors.primary).attr('opacity', 0.1);
    root
      .append('path')
      .datum(points)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', colors.primary)
      .attr('stroke-width', 2.5);
    const markers = events.filter((e) => e.date >= bounds.value.from && e.date <= through);
    root
      .append('g')
      .selectAll('circle')
      .data(markers)
      .join('circle')
      .attr('class', 'salary-change-dot')
      .attr('cx', (e) => x(new Date(e.date + 'T12:00:00')))
      .attr('cy', (e) => y(e.salary))
      .attr('r', 6)
      .attr('fill', (e) => (e.change == null ? colors.primary : e.change < 0 ? colors.appExpense : colors.appIncome))
      .attr('stroke', colors.card)
      .attr('stroke-width', 2);
    if (w > 550 && markers.length < 12)
      root
        .append('g')
        .selectAll('text')
        .data(markers.filter((e) => e.changePercent != null))
        .join('text')
        .attr('x', (e) => x(new Date(e.date + 'T12:00:00')))
        .attr('y', (e) => y(e.salary) - 14)
        .attr('text-anchor', 'middle')
        .attr('font-size', 10)
        .attr('fill', (e) => ((e.change ?? 0) < 0 ? colors.appExpense : colors.appIncome))
        .text((e) => `${(e.changePercent ?? 0) > 0 ? '+' : ''}${e.changePercent?.toFixed(1)}%`);
  }
  const cross = root
    .append('line')
    .attr('y1', m.top)
    .attr('y2', h - m.bottom)
    .attr('stroke', colors.text)
    .attr('stroke-dasharray', '4,4')
    .attr('visibility', 'hidden');
  const dots = root.append('g');
  root
    .append('rect')
    .attr('x', m.left)
    .attr('y', m.top)
    .attr('width', w - m.left - m.right)
    .attr('height', h - m.top - m.bottom)
    .attr('fill', 'transparent')
    .attr('class', 'chart-interaction-surface')
    .attr('cursor', 'crosshair')
    .style('touch-action', 'pan-y pinch-zoom')
    .on('pointermove pointerdown', (event: PointerEvent) => {
      const [mouseX, mouseY] = d3.pointer(event, svgRef.value);
      let px = Math.max(m.left, Math.min(w - m.right, mouseX));
      const markers = visibleEvents.filter((e) => e.date >= bounds.value.from);
      const nearby = nearestChartPoint(markers, +x.invert(px), (e) => +new Date(e.date + 'T12:00:00'));
      // Large invisible hit area around change dots, with the same date bisector as Balance Trend.
      const snap =
        nearby &&
        Math.hypot(x(new Date(nearby.date + 'T12:00:00')) - px, y(nearby.salary) - mouseY) <=
          (event.pointerType === 'touch' ? 32 : 24);
      if (snap) px = x(new Date(nearby.date + 'T12:00:00'));
      const selected = x.invert(px);
      const date = d3.timeFormat('%Y-%m-%d')(selected);
      tooltip.date = date;
      tooltip.events = [...grouped.values()]
        .map((events) => events.filter((e) => e.date <= date).at(-1))
        .filter((e): e is PayrollSalaryEvent => !!e)
        .filter((e) => {
          const employment = data.value?.employments.find((em) => em.id === e.employmentId);
          return !employment?.endDate || employment.endDate >= date;
        });
      tooltip.onEvent = !!snap || tooltip.events.some((e) => e.date === date);
      tooltip.visible = !!tooltip.events.length;
      cross.attr('x1', px).attr('x2', px).attr('visibility', 'visible');
      dots
        .selectAll('circle')
        .data(tooltip.events)
        .join('circle')
        .attr('cx', px)
        .attr('cy', (e) => y(e.salary))
        .attr('class', 'salary-hover-dot')
        .attr('r', snap ? 7 : 5)
        .attr('fill', colors.primary)
        .attr('stroke', colors.card)
        .attr('stroke-width', 2);
      void nextTick(() => updateTooltipPosition(event));
    })
    .on('pointerleave', (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      tooltip.visible = false;
      cross.attr('visibility', 'hidden');
      dots.selectAll('*').remove();
    });
}
watch([allEvents, bounds, currentTheme], () => nextTick(render), { deep: true });
useResizeObserver(containerRef, (entries) => {
  width.value = entries[0]?.contentRect.width ?? 700;
  render();
});
onMounted(() => nextTick(render));
</script>
<template>
  <Card class="min-w-0 p-5 sm:p-6" data-testid="payroll-salary-history"
    ><header class="mb-3 flex items-center justify-between gap-3">
      <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 class="text-lg font-semibold">Salary history</h2>
        <span
          v-if="data?.summary.salaryGrowthPercent != null"
          data-testid="salary-growth-badge"
          :class="[
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
            data.summary.salaryGrowthPercent >= 0
              ? 'bg-success-text/10 text-success-text'
              : 'bg-destructive-text/10 text-destructive-text',
          ]"
        >
          <ArrowUpRightIcon v-if="data.summary.salaryGrowthPercent >= 0" class="size-3.5" /><ArrowDownRightIcon
            v-else
            class="size-3.5"
          />
          {{ data.summary.salaryGrowthPercent > 0 ? '+' : '' }}{{ data.summary.salaryGrowthPercent.toFixed(1) }}% base
          salary growth
        </span>
      </div>
      <Popover
        ><PopoverTrigger as-child
          ><Button variant="ghost" size="icon" aria-label="Salary chart settings"
            ><SettingsIcon class="size-4" /></Button></PopoverTrigger
        ><PopoverContent align="end" class="w-72"
          ><label class="block space-y-2 text-sm"
            >Employer<select
              v-model="employmentId"
              aria-label="Salary employer"
              class="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
            >
              <option value="all">All employers</option>
              <option v-for="employment in data?.employments" :key="employment.id" :value="employment.id">
                {{ employment.employerName }} / {{ employment.jobTitle || 'Employment' }}
              </option>
            </select></label
          >
          <p class="text-muted-foreground mt-3 text-xs">
            Base salary uses regular pay rates. Event dates are first observed unless verified.
          </p></PopoverContent
        ></Popover
      >
    </header>
    <DateRange v-model="range" :earliest="earliest" class="mb-3" />
    <div v-if="query.isLoading.value && !data" class="bg-muted h-72 animate-pulse rounded-md" />
    <p v-else-if="!allEvents.length" class="text-muted-foreground py-16 text-center text-sm">
      Import payroll or add an earlier salary from Manage payroll.
    </p>
    <div v-else ref="containerRef" class="relative w-full">
      <svg
        ref="svgRef"
        class="w-full"
        :style="{ height: width < 500 ? '250px' : '300px' }"
        role="img"
        aria-label="Annualized base salary step chart"
      />
    </div>
    <div
      v-show="tooltip.visible"
      ref="tooltipRef"
      class="pointer-events-none fixed z-50 max-h-[75vh] overflow-hidden"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
    >
      <ChartTooltip
        ><ChartTooltipHeader>{{ tooltip.date }}</ChartTooltipHeader
        ><template v-for="event in tooltip.events" :key="event.id"
          ><p class="mb-1 text-xs font-medium">
            {{ event.employerName }}<template v-if="event.jobTitle"> · {{ event.jobTitle }}</template>
          </p>
          <ChartTooltipRow label="Annualized base salary" :value="money(event.salary)" total /><ChartTooltipRow
            label="Regular pay rate"
            :value="money(event.regularRate)"
          /><template v-if="event.date === tooltip.date"
            ><ChartTooltipDivider /><ChartTooltipRow
              v-if="event.previousSalary != null"
              label="Previous salary"
              :value="money(event.previousSalary)"
            /><ChartTooltipRow
              v-if="event.change != null"
              label="Change"
              :value="`${money(event.change)} (${event.changePercent?.toFixed(2) ?? '—'}%)`"
              :value-class="event.change >= 0 ? 'text-success-text' : 'text-destructive-text'"
            />
            <p class="text-card-tooltip-muted mt-1 text-xs">
              {{
                event.effectiveDate
                  ? `Verified effective ${event.effectiveDate}`
                  : `First observed ${event.firstObservedDate}`
              }}
            </p>
            <p v-if="event.notes" class="mt-1 text-xs">{{ event.notes }}</p></template
          ></template
        ></ChartTooltip
      >
    </div>
  </Card>
</template>
