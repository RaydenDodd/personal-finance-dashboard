<template>
  <Card
    :class="[
      cn('flex flex-col', $attrs.class as string),
      isDashboard ? (bounded ? 'h-full' : 'h-auto') : { 'max-h-87.5': !higher, 'max-h-181': higher },
    ]"
  >
    <CardHeader :class="isDashboard ? 'sm:py-3' : ''">
      <slot name="header">
        <div class="grid grid-cols-[minmax(0,1fr)_max-content] items-center justify-between gap-1">
          <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h3 class="min-w-0 font-semibold tracking-tight">
              <slot name="title" />
            </h3>
            <div ref="headerControls" class="flex min-w-0 flex-wrap items-center gap-1" data-widget-header-controls />
            <Loader2Icon v-if="isFetching" class="text-muted-foreground size-4 shrink-0 animate-spin" />
          </div>

          <div class="flex items-center gap-1">
            <slot name="action" />
          </div>
        </div>
      </slot>
    </CardHeader>

    <CardContent :class="isDashboard ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'h-full overflow-y-auto'">
      <slot />
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { cn } from '@/lib/utils';
import { Loader2Icon } from '@lucide/vue';
import { inject, provide, ref } from 'vue';
import { useModuleLayout } from '../composables/use-module-layout';
const { bounded } = useModuleLayout();
const headerControls = ref<HTMLElement | null>(null);
provide('widget-header-controls', headerControls);

withDefaults(
  defineProps<{
    higher?: boolean;
    isFetching?: boolean;
  }>(),
  {
    isFetching: false,
  },
);

const isDashboard = inject<boolean>('dashboard-widget-stretch', false);
</script>
