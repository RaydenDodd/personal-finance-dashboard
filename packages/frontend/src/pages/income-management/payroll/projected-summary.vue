<script setup lang="ts">
import type { IncomePlanResult } from '@bt/shared/finance-income';
import { Card } from '@/components/lib/ui/card';
import { Button } from '@/components/lib/ui/button';
import type { incomeAllocation } from '../income-allocation';
import { money } from './format';
defineProps<{
  result: IncomePlanResult | null;
  allocation: ReturnType<typeof incomeAllocation> | null;
  divisor: number;
  periodLabel: string;
}>();
defineEmits<{ edit: [] }>();
</script>
<template>
  <Card class="@container p-5 sm:p-7" data-testid="income-summary"
    ><div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="text-muted-foreground text-sm">Projected {{ periodLabel.toLowerCase() }} income</p>
        <p class="mt-2 text-4xl font-semibold tracking-tight">
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
      <Button @click="$emit('edit')">Edit projections</Button>
    </div>
    <div
      class="divide-border/60 border-border/60 mt-6 grid divide-y border-t @2xl:grid-cols-2 @2xl:divide-x @2xl:divide-y-0 @4xl:grid-cols-4"
    >
      <div v-for="item in allocation?.groups" :key="item.id" class="py-4 @2xl:px-4 @2xl:first:pl-0">
        <p class="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
          <span class="size-2 rounded-sm" :style="{ background: item.color }" />{{ item.name }}
        </p>
        <p class="mt-2 flex flex-wrap items-baseline gap-x-2 text-xl font-semibold tabular-nums">
          {{ money(item.amount)
          }}<span v-if="allocation?.flow.income" class="text-muted-foreground text-xs font-medium"
            >{{ ((item.amount / allocation.flow.income) * 100).toFixed(1) }}%</span
          >
        </p>
      </div>
    </div></Card
  >
</template>
