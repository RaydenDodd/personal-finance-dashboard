<script setup lang="ts">
import type { IncomePlanResult } from '@bt/shared/finance-income';
import { Card } from '@/components/lib/ui/card';
import { Button } from '@/components/lib/ui/button';
import type { incomeAllocation } from '../income-allocation';
import { money } from './format';
import { SquarePenIcon } from '@lucide/vue';
import ModuleBody from '@/components/widgets/components/module-body.vue';
import { useModuleLayout } from '@/components/widgets/composables/use-module-layout';
const { bounded } = useModuleLayout();
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
    ><div class="flex shrink-0 items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-muted-foreground text-sm">Projected {{ periodLabel.toLowerCase() }} income</p>
        <p
          class="mt-2 font-semibold tracking-tight"
          :class="bounded ? 'text-[clamp(1.5rem,9cqi,2.25rem)]' : 'text-4xl'"
        >
          {{ money(result ? result.annual.totalComp / divisor : null) }}
        </p>
        <p v-if="result" class="text-muted-foreground mt-2 text-xs">
          Gross income {{ money(result.annual.gross / divisor)
          }}<template v-if="result.annual.employerMatch">
            + Employer 401(k) match {{ money(result.annual.employerMatch / divisor) }}</template
          ><template v-if="result.annual.employerOtherContribution">
            + Other employer retirement {{ money(result.annual.employerOtherContribution / divisor) }}</template
          >
        </p>
      </div>
      <Button
        :size="bounded ? 'icon-sm' : 'default'"
        :variant="bounded ? 'ghost' : 'default'"
        class="shrink-0"
        aria-label="Edit projections"
        title="Edit projections"
        @click="$emit('edit')"
        ><SquarePenIcon v-if="bounded" class="size-4" /><template v-else>Edit projections</template></Button
      >
    </div>
    <ModuleBody class="divide-border/60 border-border/60 mt-3 grid grid-cols-2 divide-y border-t @4xl:grid-cols-4">
      <div v-for="item in allocation?.groups" :key="item.id" class="min-w-0 py-3 pr-2 @4xl:px-4 @4xl:first:pl-0">
        <p class="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
          <span class="size-2 rounded-sm" :style="{ background: item.color }" />{{ item.name }}
        </p>
        <p
          class="mt-2 flex flex-wrap items-baseline gap-x-2 font-semibold tabular-nums"
          :class="bounded ? 'text-lg' : 'text-xl'"
        >
          {{ money(item.amount)
          }}<span v-if="allocation?.flow.income" class="text-muted-foreground text-xs font-medium"
            >{{ ((item.amount / allocation.flow.income) * 100).toFixed(1) }}%</span
          >
        </p>
      </div>
    </ModuleBody></Card
  >
</template>
