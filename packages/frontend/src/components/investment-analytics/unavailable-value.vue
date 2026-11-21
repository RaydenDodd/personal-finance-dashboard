<script setup lang="ts">
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { InfoIcon } from '@lucide/vue';
defineProps<{ reason: string }>();
</script>
<template>
  <Popover
    ><PopoverTrigger as-child
      ><button
        type="button"
        class="text-muted-foreground inline-flex items-center gap-1 text-left"
        aria-label="Why this value is unavailable"
        data-testid="investment-missing-value"
      >
        Unavailable<InfoIcon class="size-3 shrink-0" /></button></PopoverTrigger
    ><PopoverContent class="max-w-[calc(100vw-2rem)] text-xs" align="start">{{ reason }}</PopoverContent></Popover
  >
</template>
