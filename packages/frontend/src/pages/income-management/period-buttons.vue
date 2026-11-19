<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
const value = defineModel<'biweekly' | 'monthly' | 'yearly'>({ required: true });
</script>
<template>
  <div class="flex flex-wrap gap-1" role="group" aria-label="Display period">
    <Button
      v-for="p in ['biweekly', 'monthly', 'yearly'] as const"
      :key="p"
      size="sm"
      :variant="value === p ? 'default' : 'ghost'"
      :aria-pressed="value === p"
      @click="value = p"
      >{{ p === 'biweekly' ? 'Biweekly' : p === 'monthly' ? 'Monthly' : 'Yearly' }}</Button
    >
  </div>
</template>
