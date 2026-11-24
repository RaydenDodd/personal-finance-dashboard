<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
const value = defineModel<'biweekly' | 'monthly' | 'yearly'>({ required: true });
</script>
<template>
  <div class="flex min-w-0 gap-1" role="group" aria-label="Display period">
    <Button
      v-for="p in ['biweekly', 'monthly', 'yearly'] as const"
      :key="p"
      size="sm"
      class="px-2 text-xs sm:px-3 sm:text-sm"
      :variant="value === p ? 'default' : 'ghost'"
      :aria-pressed="value === p"
      @click="value = p"
      >{{ p === 'biweekly' ? 'Biweekly' : p === 'monthly' ? 'Monthly' : 'Yearly' }}</Button
    >
  </div>
</template>
