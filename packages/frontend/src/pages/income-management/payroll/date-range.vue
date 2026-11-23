<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useDashboardPeriod } from '@/components/widgets/composables/use-dashboard-period';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { latestUsEquitySessionDate } from '@bt/shared/types/investment-market';
import {
  payrollRange,
  payrollToday,
  shiftPayrollRange,
  type PayrollRange,
  type PayrollRangePreset,
} from './date-range';
const model = defineModel<PayrollRange>({ required: true });
const props = withDefaults(defineProps<{ earliest?: string; compact?: boolean; subject?: string }>(), {
  earliest: '1900-01-01',
  subject: 'payroll',
});
const { dashboardRange } = useDashboardPeriod();
const open = ref(false),
  customFrom = ref(''),
  customThrough = ref('');
const presets = computed<{ id: PayrollRangePreset; name: string }[]>(() => [
  ...(props.subject === 'investment' ? [{ id: '1d' as const, name: '1D' }] : []),
  { id: '1w', name: '1W' },
  { id: '1m', name: '1M' },
  { id: '3m', name: '3M' },
  { id: '6m', name: '6M' },
  { id: 'ytd', name: 'YTD' },
  { id: '1y', name: '1Y' },
  { id: '2y', name: '2Y' },
  { id: '5y', name: '5Y' },
  { id: 'all', name: 'MAX' },
]);
const forwardDisabled = computed(() => shiftPayrollRange(model.value, 1) === model.value);
function choose(preset: PayrollRangePreset) {
  model.value = payrollRange(
    preset,
    props.subject === 'investment' && preset === '1d' ? latestUsEquitySessionDate() : payrollToday(),
    props.earliest,
  );
  open.value = false;
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
    v-if="!dashboardRange"
    class="flex min-w-0 flex-wrap items-center gap-1.5"
    :data-testid="subject + '-date-range'"
    data-chart-controls
  >
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button
          variant="outline"
          size="sm"
          class="h-8 max-w-full gap-2 px-2 text-xs"
          :aria-label="'Choose ' + subject + ' date range'"
        >
          <span class="shrink-0">{{ presets.find((p) => p.id === model.preset)?.name ?? 'Custom' }}</span>
          <span class="text-muted-foreground truncate text-[10px]"
            ><time :datetime="model.from">{{ model.from }}</time> &ndash;
            <time :datetime="model.through">{{ model.through }}</time></span
          >
          <ChevronDownIcon class="size-3.5 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent class="w-[min(20rem,calc(100vw-1.5rem))] p-0" align="start" :collision-padding="8">
        <ScrollArea
          class="max-h-[min(80dvh,var(--reka-popover-content-available-height))]"
          viewport-class="max-h-[min(75dvh,32rem)]"
        >
          <div class="space-y-3 p-3">
            <div class="grid grid-cols-3 gap-1" role="group" aria-label="Date presets">
              <Button
                v-for="preset in presets"
                :key="preset.id"
                size="sm"
                :variant="model.preset === preset.id ? 'secondary' : 'ghost'"
                :aria-pressed="model.preset === preset.id"
                @click="choose(preset.id)"
                >{{ preset.name }}</Button
              >
            </div>
            <div class="flex items-center justify-between border-y py-1">
              <Button
                size="icon"
                variant="ghost"
                class="size-8"
                :disabled="model.preset === 'all'"
                :aria-label="'Previous ' + subject + ' period'"
                @click="model = shiftPayrollRange(model, -1)"
                ><ChevronLeftIcon class="size-4"
              /></Button>
              <span class="text-muted-foreground text-[10px]">{{ model.from }} &ndash; {{ model.through }}</span>
              <Button
                size="icon"
                variant="ghost"
                class="size-8"
                :disabled="forwardDisabled || model.preset === 'all'"
                :aria-label="'Next ' + subject + ' period'"
                @click="model = shiftPayrollRange(model, 1)"
                ><ChevronRightIcon class="size-4"
              /></Button>
            </div>
            <form class="space-y-3" @submit.prevent="apply">
              <div class="grid grid-cols-2 gap-2">
                <label class="min-w-0 text-xs"
                  >From<input
                    v-model="customFrom"
                    type="date"
                    required
                    :max="payrollToday()"
                    class="border-input bg-background mt-1 h-9 w-full min-w-0 rounded-md border px-1 text-xs"
                /></label>
                <label class="min-w-0 text-xs"
                  >Through<input
                    v-model="customThrough"
                    type="date"
                    required
                    :min="customFrom"
                    :max="payrollToday()"
                    class="border-input bg-background mt-1 h-9 w-full min-w-0 rounded-md border px-1 text-xs"
                /></label>
              </div>
              <Button size="sm" type="submit">Apply</Button>
            </form>
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
    <slot name="actions" />
  </div>
</template>
