<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import type { PayrollCategory } from '@bt/shared/types/payroll';
defineProps<{
  categories: ReadonlyArray<{ id: PayrollCategory; name: string; color: string }>;
  hidden: PayrollCategory[];
  totalCompensation: boolean;
}>();
defineEmits<{ toggle: [id: PayrollCategory] }>();
</script>
<template>
  <div class="flex flex-wrap justify-center gap-x-2 gap-y-0.5" data-chart-legend>
    <Button
      v-for="category in categories"
      :key="category.id"
      variant="ghost"
      size="sm"
      class="h-6 gap-1 px-1.5 text-[11px]"
      :aria-pressed="!hidden.includes(category.id)"
      @click="$emit('toggle', category.id)"
    >
      <span class="size-2 rounded-sm" :style="{ background: category.color }" /><span
        :class="['text-muted-foreground', hidden.includes(category.id) && 'line-through opacity-60']"
        >{{ category.name }}</span
      >
    </Button>
    <span class="text-muted-foreground flex items-center gap-1.5 px-2 text-xs"
      ><span class="bg-primary h-0.5 w-4" />{{ totalCompensation ? 'Total compensation' : 'Gross earnings' }}</span
    >
  </div>
</template>
