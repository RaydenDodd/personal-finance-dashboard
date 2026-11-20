<script setup lang="ts">
import { cn } from '@/lib/utils';
import { useFormatCurrency } from '@/composable/formatters';
import type { PaceGeometry } from './pace-geometry';
const { formatCompactBaseCurrency } = useFormatCurrency();
defineProps<{
  geometry: PaceGeometry | null;
  width: number;
  height: number;
  tone: { stroke: string; fill: string };
  hoverX?: number | null;
  label: string;
}>();
</script>
<template>
  <svg
    v-if="geometry"
    :width="width"
    :height="height"
    class="absolute inset-0 overflow-visible"
    role="img"
    :aria-label="label"
  >
    <g v-for="tick in geometry.ticks" :key="tick.value">
      <line x1="0" :x2="width" :y1="tick.y" :y2="tick.y" class="stroke-border" stroke-dasharray="2 4" />
      <text x="0" :y="tick.y - 3" class="fill-muted-foreground text-[9px]">
        {{ formatCompactBaseCurrency({ amount: tick.value }) }}
      </text>
    </g>
    <path
      v-if="geometry.comparisonLine"
      :d="geometry.comparisonLine"
      fill="none"
      class="stroke-muted-foreground"
      stroke-opacity="0.4"
      stroke-width="1.5"
    />
    <path v-if="geometry.spentArea" :d="geometry.spentArea" class="fill-primary" fill-opacity="0.08" />
    <path
      v-if="geometry.spentLine"
      :d="geometry.spentLine"
      fill="none"
      class="stroke-primary"
      stroke-width="2.25"
      stroke-linejoin="round"
    />
    <path
      v-if="geometry.forecastLine"
      :d="geometry.forecastLine"
      fill="none"
      :class="tone.stroke"
      stroke-width="2.25"
      stroke-dasharray="0.5 5"
      stroke-linecap="round"
    />
    <line v-if="hoverX != null" :x1="hoverX" :x2="hoverX" y1="0" :y2="height" class="stroke-muted-foreground" />
    <circle
      v-for="mark in geometry.spikeMarks"
      :key="mark.day"
      :cx="mark.x"
      :cy="mark.y"
      r="3.5"
      :class="cn(tone.stroke, 'fill-card')"
      stroke-width="2"
    />
    <circle
      v-if="geometry.todayDot"
      :cx="geometry.todayDot.x"
      :cy="geometry.todayDot.y"
      r="4.5"
      class="fill-primary stroke-card"
      stroke-width="2"
    />
    <circle
      v-if="geometry.forecastDot"
      :cx="geometry.forecastDot.x"
      :cy="geometry.forecastDot.y"
      r="4.5"
      :class="cn(tone.fill, 'stroke-card')"
      stroke-width="2"
    />
  </svg>
</template>
