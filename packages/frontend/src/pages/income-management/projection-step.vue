<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { CheckIcon } from '@lucide/vue';

defineProps<{
  id: string;
  title: string;
  summary: string;
  number: number;
  open: boolean;
  reviewed: boolean;
  last: boolean;
  disabled: boolean;
}>();
defineEmits<{ 'update:open': [value: boolean]; continue: []; back: [] }>();
</script>
<template>
  <Card :id="'projection-step-' + id" class="overflow-hidden" :data-testid="'projection-step-' + id">
    <Collapsible :open="open" @update:open="$emit('update:open', $event)">
      <CollapsibleTrigger as-child>
        <button
          type="button"
          class="hover:bg-muted/50 focus-visible:ring-ring flex w-full items-center gap-3 p-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-inset sm:p-5"
          :aria-label="title"
        >
          <span
            class="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            ><CheckIcon v-if="reviewed" class="size-4" /><template v-else>{{ number }}</template></span
          >
          <span class="min-w-0 flex-1"
            ><span class="block font-semibold">{{ title }}</span
            ><span class="text-muted-foreground mt-1 block text-xs leading-relaxed">{{ summary }}</span></span
          >
          <span class="text-primary shrink-0 text-xs font-medium">{{ open ? 'Close' : 'Edit' }}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div class="border-border/60 space-y-5 border-t p-4 sm:p-5">
          <slot />
          <div class="border-border/60 flex flex-wrap justify-end gap-2 border-t pt-4">
            <Button v-if="number > 1" type="button" variant="outline" :disabled="disabled" @click="$emit('back')"
              >Back</Button
            >
            <Button type="button" :disabled="disabled" @click="$emit('continue')">{{
              last ? 'Done' : 'Continue'
            }}</Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  </Card>
</template>
