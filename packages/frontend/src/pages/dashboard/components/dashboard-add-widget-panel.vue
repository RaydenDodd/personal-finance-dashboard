<script lang="ts" setup>
import type { WidgetLayoutDefinition } from '@/components/widgets/widget-registry';
import { useI18n } from 'vue-i18n';
import { computed, ref } from 'vue';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { PlusIcon } from '@lucide/vue';

const props = defineProps<{
  availableWidgets: WidgetLayoutDefinition[];
}>();

const { t } = useI18n();
const open = ref(false),
  search = ref('');
const filtered = computed(() =>
  props.availableWidgets.filter((w) =>
    (w.literalLabels ? w.name + ' ' + w.description : t(w.name) + ' ' + t(w.description))
      .toLowerCase()
      .includes(search.value.toLowerCase()),
  ),
);
const emit = defineEmits<{
  add: [widgetId: string];
}>();
</script>

<template>
  <div v-if="availableWidgets.length" class="border-border rounded-lg border" data-testid="dashboard-add-widgets">
    <button
      type="button"
      class="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium"
      :aria-expanded="open"
      @click="open = !open"
    >
      <PlusIcon class="size-4" />{{ $t('dashboard.editMode.addWidgets') }}
    </button>
    <template v-if="open">
      <div class="px-3 pb-2">
        <input
          v-model="search"
          type="search"
          placeholder="Find a widget"
          aria-label="Find a widget"
          class="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
        />
      </div>
      <ScrollArea class="h-72" viewport-class="px-3 pb-3">
        <div class="grid gap-2">
          <button
            v-for="widget in filtered"
            :key="widget.id"
            type="button"
            class="bg-background hover:bg-muted flex min-h-11 items-center gap-3 rounded-md border p-3 text-left text-sm"
            @click="
              emit('add', widget.id);
              open = false;
            "
          >
            <PlusIcon class="text-muted-foreground size-4 shrink-0" /><span class="min-w-0">{{
              widget.literalLabels ? widget.name : $t(widget.name)
            }}</span>
          </button>
        </div>
      </ScrollArea>
    </template>
  </div>
</template>
