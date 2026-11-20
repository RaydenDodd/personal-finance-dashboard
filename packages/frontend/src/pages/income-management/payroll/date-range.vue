<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import {
  payrollRange,
  payrollToday,
  shiftPayrollRange,
  type PayrollRange,
  type PayrollRangePreset,
} from './date-range';
const model = defineModel<PayrollRange>({ required: true });
const props = withDefaults(defineProps<{ earliest?: string; compact?: boolean }>(), { earliest: '1900-01-01' });
const open = ref(false),
  customFrom = ref(''),
  customThrough = ref('');
const presets: { id: PayrollRangePreset; name: string }[] = [
  { id: '1m', name: '1M' },
  { id: '3m', name: '3M' },
  { id: '6m', name: '6M' },
  { id: 'ytd', name: 'YTD' },
  { id: '1y', name: '1Y' },
  { id: '2y', name: '2Y' },
  { id: '5y', name: '5Y' },
  { id: 'all', name: 'MAX' },
];
const forwardDisabled = computed(() => shiftPayrollRange(model.value, 1) === model.value);
function choose(preset: PayrollRangePreset) {
  model.value = payrollRange(preset, payrollToday(), props.earliest);
}
function apply() {
  if (
    customFrom.value &&
    customThrough.value &&
    customFrom.value <= customThrough.value &&
    customThrough.value <= payrollToday()
  ) {
    model.value = { preset: 'custom', from: customFrom.value, through: customThrough.value };
    open.value = false;
  }
}
</script>
<template>
  <div
    class="@container flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5"
    data-testid="payroll-date-range"
    data-chart-controls
  >
    <div class="bg-muted/60 grid w-full max-w-full grid-cols-8 items-center gap-0.5 rounded-lg p-0.5 @2xl:w-auto">
      <Button
        v-for="preset in presets"
        :key="preset.id"
        size="sm"
        :variant="model.preset === preset.id ? 'secondary' : 'ghost'"
        class="min-w-0 px-0.5 text-[11px] @2xl:min-w-8 @2xl:px-2"
        :class="compact ? 'h-6' : 'h-7'"
        :aria-pressed="model.preset === preset.id"
        @click="choose(preset.id)"
        >{{ preset.name }}</Button
      >
    </div>
    <div class="flex shrink-0 items-center gap-0.5">
      <Button
        size="icon"
        variant="ghost"
        class="size-7"
        :disabled="model.preset === 'all'"
        aria-label="Previous payroll period"
        @click="model = shiftPayrollRange(model, -1)"
        ><ChevronLeftIcon class="size-4"
      /></Button>
      <p
        class="text-muted-foreground flex items-center justify-center gap-x-1 text-[10px] whitespace-nowrap tabular-nums sm:text-[11px]"
      >
        <time class="whitespace-nowrap" :datetime="model.from">{{ model.from }}</time
        ><span>&ndash;</span><time class="whitespace-nowrap" :datetime="model.through">{{ model.through }}</time>
      </p>
      <Button
        size="icon"
        variant="ghost"
        class="size-7"
        :disabled="forwardDisabled || model.preset === 'all'"
        aria-label="Next payroll period"
        @click="model = shiftPayrollRange(model, 1)"
        ><ChevronRightIcon class="size-4"
      /></Button>
      <Popover v-model:open="open"
        ><PopoverTrigger as-child
          ><Button size="icon" variant="ghost" class="size-7" aria-label="Custom payroll date range"
            ><CalendarIcon class="size-3.5" /></Button></PopoverTrigger
        ><PopoverContent class="w-72" align="end"
          ><form class="space-y-3" @submit.prevent="apply">
            <p class="text-sm font-medium">Custom date range</p>
            <label class="block text-xs"
              >From<input
                v-model="customFrom"
                type="date"
                required
                :max="payrollToday()"
                class="border-input bg-background mt-1 h-9 w-full rounded-md border px-2" /></label
            ><label class="block text-xs"
              >Through<input
                v-model="customThrough"
                type="date"
                required
                :min="customFrom"
                :max="payrollToday()"
                class="border-input bg-background mt-1 h-9 w-full rounded-md border px-2" /></label
            ><Button size="sm" type="submit">Apply</Button>
          </form></PopoverContent
        ></Popover
      >
      <slot name="actions" />
    </div>
  </div>
</template>
