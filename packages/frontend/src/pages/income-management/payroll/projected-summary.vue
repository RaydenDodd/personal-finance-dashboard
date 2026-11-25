<script setup lang="ts">
import { useDashboardPeriod } from '@/components/widgets/composables/use-dashboard-period';
import type { IncomePlanResult } from '@bt/shared/finance-income';
import { Card } from '@/components/lib/ui/card';
import { Button } from '@/components/lib/ui/button';
import type { incomeAllocation } from '../income-allocation';
import { money } from './format';
import { SquarePenIcon } from '@lucide/vue';
import ModuleBody from '@/components/widgets/components/module-body.vue';
import { useModuleLayout } from '@/components/widgets/composables/use-module-layout';
const { bounded } = useModuleLayout();
const { dashboardRange } = useDashboardPeriod();
defineProps<{
  result: IncomePlanResult | null;
  allocation: ReturnType<typeof incomeAllocation> | null;
  divisor: number;
  periodLabel: string;
}>();
defineEmits<{ edit: [] }>();
</script>
<template>
  <Card
    class="@container flex min-h-0 min-w-0 flex-col overflow-hidden"
    :class="bounded ? 'h-full p-4' : 'p-5 sm:p-7'"
    data-testid="income-summary"
    ><header v-if="$slots.action" class="mb-3 flex items-center justify-between gap-2">
      <h3 class="font-semibold">Projected income</h3>
      <slot name="action" />
    </header>
    <div class="flex shrink-0 items-start justify-between gap-3">
      <div class="min-w-0">
        <p v-if="!$slots.action" class="text-muted-foreground text-sm">
          Projected {{ periodLabel.toLowerCase() }} income
        </p>
        <p
          class="mt-2 font-semibold tracking-tight"
          :class="bounded ? 'text-[clamp(1.5rem,9cqi,2.25rem)]' : 'text-[clamp(1.25rem,8cqi,2.25rem)]'"
        >
          {{ money(result ? result.annual.totalComp / divisor : null) }}
        </p>
        <p v-if="result && !dashboardRange" class="text-muted-foreground mt-2 text-xs">
          Gross income {{ money(result.annual.gross / divisor)
          }}<template v-if="result.annual.employerMatch">
            + Employer 401(k) match {{ money(result.annual.employerMatch / divisor) }}</template
          ><template v-if="result.annual.employerOtherContribution">
            + Other employer retirement {{ money(result.annual.employerOtherContribution / divisor) }}</template
          >
        </p>
      </div>
      <Button
        v-if="!$slots.action"
        :size="bounded || dashboardRange ? 'icon-sm' : 'default'"
        :variant="bounded || dashboardRange ? 'ghost' : 'default'"
        class="shrink-0 max-sm:size-8 max-sm:p-0"
        aria-label="Edit projections"
        title="Edit projections"
        @click="$emit('edit')"
        ><SquarePenIcon :class="bounded || dashboardRange ? 'size-4' : 'size-4 sm:hidden'" /><span
          v-if="!bounded && !dashboardRange"
          class="hidden sm:inline"
          >Edit projections</span
        ></Button
      >
    </div>
    <ModuleBody
      class="border-border/60 mt-3 grid grid-cols-1 gap-x-3 gap-y-1 border-t @xs:grid-cols-2 @4xl:grid-cols-5"
    >
      <div v-for="item in allocation?.groups" :key="item.id" class="min-w-0 py-3">
        <p class="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
          <span class="size-2 shrink-0 rounded-sm" :style="{ background: item.color }" />{{ item.name }}
        </p>
        <p
          class="mt-2 flex min-w-0 flex-nowrap items-baseline gap-x-1.5 whitespace-nowrap text-[clamp(.875rem,3.5cqi,1.125rem)] font-semibold tabular-nums @4xl:text-[clamp(.875rem,1.65cqi,1.125rem)]"
        >
          <span>{{ money(item.amount) }}</span><span v-if="allocation?.flow.income" class="text-muted-foreground shrink-0 text-[.6875rem] font-medium @5xl:text-xs"
            >{{ ((item.amount / allocation.flow.income) * 100).toFixed(1) }}%</span
          >
        </p>
      </div>
    </ModuleBody></Card
  >
</template>
