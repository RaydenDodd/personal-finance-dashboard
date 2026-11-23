<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/lib/ui/popover';
import { ArrowUpRightIcon, SettingsIcon } from '@lucide/vue';
withDefaults(defineProps<{ projected?: boolean; settings?: boolean }>(), { settings: true });
</script>
<template>
  <div class="flex shrink-0 items-center gap-1">
    <Button
      as-child
      variant="ghost"
      size="icon-sm"
      :aria-label="projected ? 'Open Projected Income' : 'Open Actual Income'"
      ><router-link :to="projected ? '/finances/income/projected' : '/finances/income/actual'"
        ><ArrowUpRightIcon class="text-muted-foreground size-4" /></router-link></Button
    ><Popover v-if="settings"
      ><PopoverTrigger as-child
        ><Button variant="ghost" size="icon-sm" aria-label="Income widget settings"
          ><SettingsIcon class="text-muted-foreground size-4" /></Button></PopoverTrigger
      ><PopoverContent align="end" class="w-56"
        ><Button as-child variant="ghost" class="w-full justify-start"
          ><router-link :to="projected ? '/finances/income/projected' : '/finances/income/actual'">{{
            projected ? 'Edit projections' : 'Manage payroll'
          }}</router-link></Button
        ></PopoverContent
      ></Popover
    >
  </div>
</template>
