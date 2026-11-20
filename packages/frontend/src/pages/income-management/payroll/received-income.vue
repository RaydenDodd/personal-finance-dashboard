<script setup lang="ts">
import type { PayrollCategory, PayrollDashboard, PayrollPeriod } from '@bt/shared/types/payroll';
import { currentTheme } from '@/common/utils/color-theme';
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { SettingsIcon } from '@lucide/vue';
import {
  ChartTooltip,
  ChartTooltipHeader,
  ChartTooltipRow,
  ChartTooltipDivider,
} from '@/components/common/charts/chart-tooltip';
import { getChartColors } from '@/composable/charts/chart-colors';
import { formatAxisCurrency } from '@/composable/charts/format-axis-currency';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { useLocalStorage, useResizeObserver } from '@vueuse/core';
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import * as d3 from 'd3';
import DateRange from './date-range.vue';
import { payrollRange, payrollToday, type PayrollRange } from './date-range';
import { usePayroll } from './use-payroll';
import { money, payrollCategories } from './format';
import { payrollPeriodFieldUnavailable } from './completeness';
const props = withDefaults(defineProps<{ data?: PayrollDashboard; settingsKey?: string }>(), {
  settingsKey: 'payroll:received-income',
});
const savedRange = useLocalStorage<PayrollRange>(props.settingsKey + ':range', payrollRange('ytd'));
const range = ref(savedRange.value.preset === 'custom' ? savedRange.value : payrollRange(savedRange.value.preset));
watch(
  range,
  (value) => {
    savedRange.value = value;
  },
  { deep: true },
);
const aggregation = useLocalStorage<'paycheck' | 'monthly' | 'quarterly' | 'yearly'>(
  props.settingsKey + ':aggregation',
  'monthly',
);
const employmentId = useLocalStorage(props.settingsKey + ':employment', 'all'),
  percentage = useLocalStorage(props.settingsKey + ':percentage', false),
  totalCompensation = ref(true),
  hidden = useLocalStorage<PayrollCategory[]>(props.settingsKey + ':hidden', []);
const query = usePayroll(() => ({
  from: range.value.from,
  through: range.value.through,
  employmentId: employmentId.value === 'all' ? undefined : employmentId.value,
  aggregation: aggregation.value,
}));
const data = computed(() => query.data.value ?? props.data);
watch(
  () => data.value?.summary.coverageFrom,
  (value) => {
    if (value && range.value.preset === 'all' && range.value.from !== value)
      range.value = { ...range.value, from: value };
  },
);
const rows = computed(() => data.value?.received ?? []);
const categories = computed(() =>
  payrollCategories.filter(
    (c) =>
      (c.id !== 'employerRetirement' || totalCompensation.value) && rows.value.some((r) => r.allocations[c.id] !== 0),
  ),
);
const visible = computed(() => categories.value.filter((c) => !hidden.value.includes(c.id)));
const containerRef = ref<HTMLElement | null>(null),
  svgRef = ref<SVGSVGElement | null>(null),
  tooltipRef = ref<HTMLElement | null>(null),
  width = ref(700);
const tooltip = reactive({ visible: false, x: 0, y: 0, row: null as PayrollPeriod | null });
const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip, strategy: 'fixed' });
const lineTotal = (row: PayrollPeriod) => (totalCompensation.value ? row.totalCompensation : row.gross);
const periodLabel = (row: PayrollPeriod) =>
  aggregation.value === 'paycheck'
    ? row.date
    : aggregation.value === 'monthly'
      ? d3.timeFormat('%b %Y')(new Date(row.date + 'T12:00:00'))
      : aggregation.value === 'quarterly'
        ? `Q${Math.floor((Number(row.date.slice(5, 7)) - 1) / 3) + 1} ${row.date.slice(0, 4)}`
        : row.date.slice(0, 4);
function toggle(id: PayrollCategory) {
  hidden.value = hidden.value.includes(id) ? hidden.value.filter((k) => k !== id) : [...hidden.value, id];
}
function render() {
  if (!svgRef.value) return;
  tooltip.visible = false;
  const root = d3.select(svgRef.value),
    colors = getChartColors(),
    w = Math.max(280, width.value),
    h = w < 500 ? 260 : 320,
    m = { left: 55, right: 16, top: 20, bottom: 48 };
  root.selectAll('*').remove();
  root.attr('viewBox', `0 0 ${w} ${h}`);
  if (!rows.value.length) return;
  const x = d3
    .scaleBand<number>()
    .domain(rows.value.map((_, i) => i))
    .range([m.left, w - m.right])
    .padding(rows.value.length > 40 ? 0.2 : 0.35);
  const value = (r: PayrollPeriod, id: string) =>
    percentage.value
      ? lineTotal(r) > 0
        ? (r.allocations[id as PayrollCategory] / lineTotal(r)) * 100
        : 0
      : r.allocations[id as PayrollCategory];
  const stack = d3
    .stack<PayrollPeriod>()
    .keys(visible.value.map((c) => c.id))
    .value((r, id) => value(r, id))
    .offset(d3.stackOffsetDiverging)(rows.value);
  const min = d3.min(stack, (s) => d3.min(s, (d) => Math.min(d[0], d[1]))) ?? 0,
    max = Math.max(
      d3.max(stack, (s) => d3.max(s, (d) => Math.max(d[0], d[1]))) ?? 0,
      percentage.value ? 100 : (d3.max(rows.value, lineTotal) ?? 0),
    );
  const y = d3
    .scaleLinear()
    .domain([Math.min(0, min), Math.max(1, max)])
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
        .tickFormat((v) => (percentage.value ? `${v}%` : formatAxisCurrency({ value: Number(v), symbol: '$' }))),
    )
    .call((g) => g.select('.domain').remove())
    .call((g) => g.selectAll('line').attr('stroke', colors.grid).attr('stroke-opacity', 0.5))
    .call((g) => g.selectAll('text').attr('fill', colors.text));
  const tickStep = Math.max(1, Math.ceil(rows.value.length / (w < 450 ? 4 : 8)));
  const tickValues = rows.value.map((_, i) => i).filter((i) => i % tickStep === 0 || i === rows.value.length - 1);
  if (tickValues.length > 2 && (tickValues.at(-1)! - tickValues.at(-2)!) * x.step() < (w < 500 ? 58 : 72))
    tickValues.splice(-2, 1);
  const oneYear = new Set(rows.value.map((row) => row.date.slice(0, 4))).size === 1;
  root
    .append('g')
    .attr('transform', `translate(0,${h - m.bottom})`)
    .call(
      d3
        .axisBottom(x)
        .tickValues(tickValues)
        .tickFormat((i) =>
          aggregation.value === 'monthly' && w < 500
            ? d3.timeFormat(oneYear ? '%b' : '%b %y')(new Date(rows.value[i]!.date + 'T12:00:00'))
            : periodLabel(rows.value[i]!),
        ),
    )
    .call((g) => g.selectAll('text').attr('fill', colors.text).attr('font-size', 10))
    .call((g) => g.selectAll('line,path').attr('stroke', colors.grid));
  root
    .append('g')
    .selectAll('g')
    .data(stack)
    .join('g')
    .attr('fill', (s) => categories.value.find((c) => c.id === s.key)!.color)
    .selectAll('rect')
    .data((s) => s)
    .join('rect')
    .attr('x', (_d, i) => x(i) ?? 0)
    .attr('y', (d) => y(Math.max(d[0], d[1])))
    .attr('height', (d) => Math.abs(y(d[0]) - y(d[1])))
    .attr('width', x.bandwidth())
    .attr('rx', 1);
  if (!percentage.value) {
    root
      .append('path')
      .datum(rows.value)
      .attr(
        'd',
        d3
          .line<PayrollPeriod>()
          .x((_d, i) => (x(i) ?? 0) + x.bandwidth() / 2)
          .y((d) => y(lineTotal(d))),
      )
      .attr('fill', 'none')
      .attr('stroke', colors.primary)
      .attr('stroke-width', 2.5);
  }
  const cross = root
      .append('line')
      .attr('y1', m.top)
      .attr('y2', h - m.bottom)
      .attr('stroke', colors.text)
      .attr('stroke-dasharray', '4,4')
      .attr('visibility', 'hidden'),
    highlight = root
      .append('rect')
      .attr('y', m.top)
      .attr('height', h - m.top - m.bottom)
      .attr('fill', colors.foreground)
      .attr('opacity', 0.05)
      .attr('visibility', 'hidden'),
    dot = root
      .append('circle')
      .attr('r', 4)
      .attr('fill', colors.primary)
      .attr('stroke', colors.card)
      .attr('stroke-width', 2)
      .attr('visibility', 'hidden');
  root
    .append('rect')
    .attr('x', m.left)
    .attr('y', m.top)
    .attr('width', w - m.left - m.right)
    .attr('height', h - m.top - m.bottom)
    .attr('fill', 'transparent')
    .style('touch-action', 'pan-y')
    .on('pointermove pointerdown', (event: PointerEvent) => {
      const [px] = d3.pointer(event, svgRef.value);
      const i = Math.min(rows.value.length - 1, Math.max(0, Math.round((px - m.left - x.bandwidth() / 2) / x.step())));
      const row = rows.value[i];
      if (!row) return;
      tooltip.row = row;
      tooltip.visible = true;
      const cx = (x(i) ?? 0) + x.bandwidth() / 2;
      cross.attr('x1', cx).attr('x2', cx).attr('visibility', 'visible');
      highlight
        .attr('x', (x(i) ?? 0) - 3)
        .attr('width', x.bandwidth() + 6)
        .attr('visibility', 'visible');
      dot
        .attr('cx', cx)
        .attr('cy', y(lineTotal(row)))
        .attr('visibility', percentage.value ? 'hidden' : 'visible');
      void nextTick(() => updateTooltipPosition(event));
    })
    .on('pointerleave', () => {
      tooltip.visible = false;
      cross.attr('visibility', 'hidden');
      highlight.attr('visibility', 'hidden');
      dot.attr('visibility', 'hidden');
    });
}
watch([rows, visible, percentage, totalCompensation, currentTheme], () => nextTick(render), { deep: true });
useResizeObserver(containerRef, (e) => {
  width.value = e[0]?.contentRect.width ?? 700;
  render();
});
onMounted(() => nextTick(render));
</script>
<template>
  <Card class="min-w-0 p-5 sm:p-6" data-testid="payroll-received-income"
    ><header class="mb-3 flex items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">Received income</h2>
        <p class="text-muted-foreground text-xs">Total compensation</p>
      </div>
      <Popover
        ><PopoverTrigger as-child
          ><Button variant="ghost" size="icon" aria-label="Received income chart settings"
            ><SettingsIcon class="size-4" /></Button></PopoverTrigger
        ><PopoverContent align="end" class="w-80 space-y-4"
          ><div>
            <p class="mb-2 text-sm font-medium">Aggregation</p>
            <div class="bg-muted flex rounded-lg p-1">
              <Button
                v-for="option in [
                  { id: 'paycheck', label: 'Paycheck' },
                  { id: 'monthly', label: 'Month' },
                  { id: 'quarterly', label: 'Quarter' },
                  { id: 'yearly', label: 'Year' },
                ]"
                :key="option.id"
                size="sm"
                :variant="aggregation === option.id ? 'secondary' : 'ghost'"
                class="h-7 flex-1 px-2 text-xs"
                @click="aggregation = option.id as typeof aggregation"
                >{{ option.label }}</Button
              >
            </div>
          </div>
          <div>
            <p class="mb-2 text-sm font-medium">Display</p>
            <div class="bg-muted inline-flex rounded-lg p-1">
              <Button
                size="sm"
                class="h-7 px-3 text-xs"
                :variant="!percentage ? 'secondary' : 'ghost'"
                @click="percentage = false"
                >Dollars</Button
              ><Button
                size="sm"
                class="h-7 px-3 text-xs"
                :variant="percentage ? 'secondary' : 'ghost'"
                @click="percentage = true"
                >Percent</Button
              >
            </div>
          </div>
          <label class="block space-y-2 text-sm"
            >Employer<select
              v-model="employmentId"
              aria-label="Received income employer"
              class="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
            >
              <option value="all">All employers</option>
              <option v-for="employment in data?.employments" :key="employment.id" :value="employment.id">
                {{ employment.employerName }} / {{ employment.jobTitle || 'Employment' }}
              </option>
            </select></label
          >
          <p class="text-muted-foreground text-xs">
            Employer retirement is included in total compensation. Gross earnings remain available in the tooltip.
          </p></PopoverContent
        ></Popover
      >
    </header>
    <DateRange v-model="range" :earliest="data?.summary.coverageFrom ?? '1900-01-01'" class="mb-3" />
    <div v-if="query.isLoading.value && !data" class="bg-muted h-80 animate-pulse rounded-md" />
    <p v-else-if="query.isError.value" class="text-destructive-text py-10 text-center text-sm">
      Received income could not be loaded.
    </p>
    <p v-else-if="!rows.length" class="text-muted-foreground py-16 text-center text-sm">
      No payroll recorded for this period.
    </p>
    <div v-else ref="containerRef" class="relative">
      <svg
        ref="svgRef"
        class="w-full"
        :style="{ height: width < 500 ? '260px' : '320px' }"
        role="img"
        aria-label="Actual payroll allocation stacked bars and total compensation line"
      />
    </div>
    <div class="mt-2 flex flex-wrap justify-center gap-1">
      <Button
        v-for="category in categories"
        :key="category.id"
        variant="ghost"
        size="sm"
        class="h-6 gap-1 px-1.5 text-[11px]"
        :aria-pressed="!hidden.includes(category.id)"
        @click="toggle(category.id)"
        ><span class="size-2 rounded-sm" :style="{ background: category.color }" /><span
          :class="['text-muted-foreground', hidden.includes(category.id) && 'line-through opacity-60']"
          >{{ category.name }}</span
        ></Button
      ><span v-if="!percentage" class="text-muted-foreground flex items-center gap-1.5 px-2 text-xs"
        ><span class="bg-primary h-0.5 w-4" />{{ totalCompensation ? 'Total compensation' : 'Gross earnings' }}</span
      >
    </div>
    <p v-if="percentage" class="text-muted-foreground mt-2 text-xs">
      Percent of total compensation. Dollar amounts are available in the tooltip.
    </p>
    <div
      v-show="tooltip.visible"
      ref="tooltipRef"
      class="pointer-events-none fixed z-50 max-h-[80vh] overflow-hidden"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
    >
      <ChartTooltip v-if="tooltip.row"
        ><ChartTooltipHeader
          >{{ periodLabel(tooltip.row)
          }}<span v-if="tooltip.row.incomplete" class="text-card-tooltip-muted ml-2 text-xs"
            >Partial period</span
          ></ChartTooltipHeader
        ><ChartTooltipRow label="Gross earnings" :value="money(tooltip.row.gross)" total /><ChartTooltipRow
          label="Regular earnings"
          :value="
            money(payrollPeriodFieldUnavailable(data, tooltip.row, 'regularEarnings') ? null : tooltip.row.regular)
          "
        /><ChartTooltipRow
          label="Additional earnings"
          :value="
            money(payrollPeriodFieldUnavailable(data, tooltip.row, 'regularEarnings') ? null : tooltip.row.additional)
          "
        /><ChartTooltipRow
          v-if="tooltip.row.bonus"
          label="Bonuses and awards"
          :value="money(tooltip.row.bonus)"
        /><ChartTooltipDivider /><ChartTooltipRow
          v-for="category in categories.filter((c) => tooltip.row!.allocations[c.id] !== 0)"
          :key="category.id"
          :label="category.name"
          :color="category.color"
          :value="`${money(tooltip.row.allocations[category.id])}${lineTotal(tooltip.row) > 0 ? ' · ' + ((tooltip.row.allocations[category.id] / lineTotal(tooltip.row)) * 100).toFixed(1) + '%' : ''}`"
        /><ChartTooltipDivider /><ChartTooltipRow
          label="Employee retirement"
          :value="money(tooltip.row.employeeRetirement)"
        /><ChartTooltipRow label="Employer retirement" :value="money(tooltip.row.employerRetirement)" /><ChartTooltipRow
          label="Total compensation"
          :value="money(tooltip.row.totalCompensation)"
          total
        /><ChartTooltipRow
          v-if="!tooltip.row.incomplete && tooltip.row.change != null"
          label="Change vs previous period"
          :value="`${money(tooltip.row.change)}${tooltip.row.changePercent != null ? ' · ' + tooltip.row.changePercent.toFixed(1) + '%' : ''}`"
        />
        <p
          v-if="payrollPeriodFieldUnavailable(data, tooltip.row, 'withholding')"
          class="text-card-tooltip-muted mt-2 text-xs"
        >
          Withholding fields are incomplete. Unreconciled payroll is shown separately; missing taxes are not verified
          zero amounts.
        </p>
        <p v-if="tooltip.row.incomplete" class="text-card-tooltip-muted mt-2 text-xs">
          Comparison withheld for an incomplete period.
        </p></ChartTooltip
      >
    </div>
  </Card>
</template>
