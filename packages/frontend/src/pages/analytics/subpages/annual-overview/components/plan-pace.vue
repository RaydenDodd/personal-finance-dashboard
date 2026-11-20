<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { useElementSize, onClickOutside } from '@vueuse/core';
import { format } from 'date-fns';
import { getIncomePlanPace } from '@/api/income-management';
import PacePlot from '@/components/widgets/spending-pace-widget/pace-plot.vue';
import { buildPaceGeometry } from '@/components/widgets/spending-pace-widget/pace-geometry';
import { ChartTooltip, ChartTooltipHeader, ChartTooltipRow } from '@/components/common/charts/chart-tooltip';
import { Button } from '@/components/lib/ui/button';
const props = defineProps<{ from: Date; to: Date; metric: 'income' | 'savings' }>();
const key = computed(() => ({ from: format(props.from, 'yyyy-MM-dd'), through: format(props.to, 'yyyy-MM-dd') }));
const { data, isLoading, isError, refetch } = useQuery({
  queryKey: computed(() => ['income-plan-pace', key.value]),
  queryFn: () => getIncomePlanPace(key.value.from, key.value.through),
  staleTime: 0,
});
const money = (n: number | null | undefined) =>
  n == null ? 'Unavailable' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
const points = computed(() => data.value?.points ?? []),
  actual = computed(() => points.value.map((p) => p[props.metric]));
const plan = computed(() => points.value.map((p) => (props.metric === 'income' ? p.plannedIncome : p.plannedSavings)));
const last = computed(() => actual.value.findLastIndex((v) => v !== null));
const observedStart = computed(() => actual.value.findIndex((v) => v !== null));
const forecast = computed(() => {
  if (last.value < 0 || last.value >= points.value.length - 1) return null;
  const rate = actual.value[last.value]! / (last.value - observedStart.value + 1);
  return points.value.map((_, i) => (i < last.value ? null : actual.value[last.value]! + rate * (i - last.value)));
});
const tone = computed(() =>
  (forecast.value?.at(-1) ?? actual.value[last.value] ?? 0) >= (plan.value.at(-1) ?? 0)
    ? { stroke: 'stroke-app-income-color', fill: 'fill-app-income-color', border: 'border-app-income-color' }
    : { stroke: 'stroke-app-expense-color', fill: 'fill-app-expense-color', border: 'border-app-expense-color' },
);
const plot = useTemplateRef<HTMLElement>('plot');
const { width, height } = useElementSize(plot);
const geometry = computed(() =>
  buildPaceGeometry({
    width: width.value,
    height: height.value,
    actual: actual.value,
    comparison: plan.value,
    forecast: forecast.value,
    todayIndex: last.value,
    days: points.value.length,
  }),
);
const hoverIndex = ref<number | null>(null);
onClickOutside(plot, () => {
  hoverIndex.value = null;
});
function pointer(e: PointerEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  hoverIndex.value = Math.round(
    Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * Math.max(0, points.value.length - 1),
  );
}
const hover = computed(() => (hoverIndex.value === null ? null : points.value[hoverIndex.value]));
const ticks = computed(() =>
  [
    ...new Set([
      0,
      Math.round((points.value.length - 1) * 0.25),
      Math.round((points.value.length - 1) * 0.5),
      Math.round((points.value.length - 1) * 0.75),
      points.value.length - 1,
    ]),
  ].filter((i) => i >= 0 && points.value[i]),
);
const dateLabel = (date: string) => format(new Date(date + 'T12:00:00'), 'MMM d, yyyy');
const detailsOpen = ref(false);
</script>
<template>
  <section class="bg-card border-border space-y-4 rounded-lg border p-5 sm:p-6" :data-testid="metric + '-plan-pace'">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold">{{ metric === 'income' ? 'Income pace' : 'Savings pace' }}</h2>
      <router-link to="/finances/income" class="text-primary text-sm hover:underline">Edit Income plan</router-link>
    </header>
    <p v-if="isLoading" class="text-muted-foreground py-16 text-center">Loading planned and actual progress...</p>
    <div v-else-if="isError" class="py-10 text-center">
      <p>Progress could not be loaded.</p>
      <Button variant="ghost" @click="refetch()">Retry</Button>
    </div>
    <template v-else-if="data">
      <div class="divide-border grid gap-3 sm:grid-cols-3 sm:divide-x">
        <div>
          <p class="text-muted-foreground text-xs">
            {{ metric === 'income' ? 'Received take-home income' : 'Net savings and investment funding' }}
          </p>
          <p class="mt-1 text-3xl font-bold tabular-nums">{{ money(last >= 0 ? actual[last] : null) }}</p>
        </div>
        <div class="sm:pl-4">
          <p class="text-muted-foreground text-xs">Income plan - selected period</p>
          <p class="mt-1 text-xl font-semibold tabular-nums">{{ money(plan.at(-1)) }}</p>
        </div>
        <div class="sm:pl-4">
          <p class="text-muted-foreground text-xs">
            {{ forecast ? 'At current pace - period end' : 'Actual vs plan - observed dates' }}
          </p>
          <p class="mt-1 text-xl font-semibold tabular-nums">
            {{
              forecast
                ? '~' + money(forecast.at(-1))
                : money(
                    last >= 0 && plan[last] != null
                      ? actual[last]! - ((plan[last] ?? 0) - (observedStart > 0 ? (plan[observedStart - 1] ?? 0) : 0))
                      : null,
                  )
            }}
          </p>
        </div>
      </div>
      <p v-if="!data.planName" class="text-muted-foreground text-sm">
        Set your salary and allocations in Income to see the planned line.
      </p>
      <p v-if="data.coverageFrom && data.coverageFrom > data.from" class="text-muted-foreground text-xs">
        Connected transaction coverage begins {{ dateLabel(data.coverageFrom) }}. Earlier actual values are unavailable.
      </p>
      <div
        ref="plot"
        class="relative h-64 touch-pan-y sm:h-80"
        @pointermove="pointer"
        @pointerdown="pointer"
        @pointerleave="
          (event) => {
            if (event.pointerType !== 'touch') hoverIndex = null;
          }
        "
      >
        <PacePlot
          :geometry="geometry"
          :width="width"
          :height="height"
          :tone="tone"
          :hover-x="hoverIndex == null ? null : geometry?.x(hoverIndex)"
          :label="metric === 'income' ? 'Income actual, forecast and plan' : 'Savings actual, forecast and plan'"
        />
        <ChartTooltip
          v-if="hover"
          class="pointer-events-none absolute top-0 z-10"
          :style="hoverIndex! > points.length / 2 ? { right: '8px' } : { left: '8px' }"
          data-testid="plan-pace-tooltip"
        >
          <ChartTooltipHeader>{{ dateLabel(hover.date) }}</ChartTooltipHeader>
          <ChartTooltipRow label="Actual" :value="money(actual[hoverIndex!])" /><ChartTooltipRow
            label="Income plan"
            :value="money(plan[hoverIndex!])"
          />
          <ChartTooltipRow
            v-if="forecast?.[hoverIndex!] != null"
            label="Forecast"
            :value="'~' + money(forecast[hoverIndex!])"
          />
        </ChartTooltip>
      </div>
      <div class="text-muted-foreground relative h-5 text-[10px]">
        <span
          v-for="i in ticks"
          :key="i"
          class="absolute whitespace-nowrap"
          :style="{
            left: (100 * i) / Math.max(1, points.length - 1) + '%',
            transform: i === 0 ? 'none' : i === points.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
          }"
          >{{ format(new Date(points[i]!.date + 'T12:00:00'), points.length > 365 ? 'MMM yy' : 'MMM d') }}</span
        >
      </div>
      <div class="text-muted-foreground flex flex-wrap gap-4 text-xs">
        <span class="flex items-center gap-2"><i class="border-primary w-5 border-t-2" />Actual</span
        ><span class="flex items-center gap-2"
          ><i class="border-muted-foreground w-5 border-t-2 opacity-45" />Income plan</span
        ><span v-if="forecast" class="flex items-center gap-2"
          ><i class="w-5 border-t-2 border-dotted" :class="tone.border" />Forecast</span
        >
      </div>
      <p class="text-muted-foreground text-xs">
        {{ data.planBasis
        }}{{ forecast ? ' Forecast follows observed average progress; real paydays and transfers are uneven.' : '' }}
      </p>
      <template v-if="metric === 'savings'"
        ><p class="text-muted-foreground text-xs">
          {{ data.savingsBasis }} Cash flow's Saved figure instead measures income minus expenses.
        </p>
        <Button variant="ghost" size="sm" :aria-expanded="detailsOpen" @click="detailsOpen = !detailsOpen"
          >{{ detailsOpen ? 'Hide' : 'View' }} funding transactions ({{ data.funding.length }})</Button
        >
        <div v-if="detailsOpen" class="divide-border divide-y" data-testid="savings-funding-details">
          <div v-for="e in data.funding" :key="e.id" class="flex justify-between gap-4 py-3 text-sm">
            <div>
              <p>{{ e.description }}</p>
              <p class="text-muted-foreground text-xs">{{ dateLabel(e.date) }}</p>
            </div>
            <span class="shrink-0 tabular-nums">{{ money(e.amount) }}</span>
          </div>
          <p v-if="!data.funding.length" class="text-muted-foreground py-4 text-sm">
            No recorded funding transfers in this period.
          </p>
        </div></template
      >
    </template>
  </section>
</template>
