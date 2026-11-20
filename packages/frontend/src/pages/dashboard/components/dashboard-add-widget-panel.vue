<script lang="ts" setup>
import type { WidgetLayoutDefinition } from '@/components/widgets/widget-registry';
import { PlusIcon } from '@lucide/vue';

defineProps<{
  availableWidgets: WidgetLayoutDefinition[];
}>();

const emit = defineEmits<{
  add: [widgetId: string];
}>();
</script>

<template>
  <div v-if="availableWidgets.length" class="border-border rounded-lg border border-dashed p-4">
    <p class="text-muted-foreground mb-3 text-sm font-medium">{{ $t('dashboard.editMode.addWidgets') }}</p>
    <div class="grid grid-cols-1 gap-2">
      <button
        v-for="widget in availableWidgets"
        :key="widget.id"
        class="bg-background hover:bg-muted flex items-center gap-3 rounded-md border p-3 text-left transition-colors"
        @click="emit('add', widget.id)"
      >
        <PlusIcon class="text-muted-foreground size-4 shrink-0" />
        <div class="min-w-0">
          <p class="text-sm font-medium">{{ widget.literalLabels ? widget.name : $t(widget.name) }}</p>
          <p class="text-muted-foreground line-clamp-2 text-xs">
            {{ widget.literalLabels ? widget.description : $t(widget.description) }}
          </p>
        </div>
      </button>
    </div>
  </div>
</template>
