<script lang="ts" setup>
import { LayoutGridIcon } from '@lucide/vue';
import { provide, computed, nextTick } from 'vue';
import type { DashboardWidgetConfig, DashboardPage } from '@/api/user-settings';
import type { WidgetLayoutDefinition } from '@/components/widgets/widget-registry';
import { VueDraggable } from 'vue-draggable-plus';

import { useDashboardLayout } from '../composables/use-dashboard-layout';
import type { Period } from '../types';
import DashboardAddWidgetPanel from './dashboard-add-widget-panel.vue';
import DashboardWidgetSlot from './dashboard-widget-slot.vue';

const props = defineProps<{
  currentPeriod?: Period;
  page?: DashboardPage;
  registry?: Record<string, WidgetLayoutDefinition>;
  defaultLayout?: DashboardWidgetConfig[];
  naturalHeight?: boolean;
  columns?: 3 | 4;
}>();

const {
  isEditMode,
  isSaving,
  activeWidgets,
  draftWidgets,
  displayWidgets,
  availableWidgets,
  enterEditMode,
  saveLayout,
  cancelEdit,
  removeWidget,
  addWidget,
  moveWidget,
  revealWidget,
  resizeWidget,
  updateWidgetConfig,
  saveWidgetConfigDirect,
} = useDashboardLayout({
  page: props.page,
  registry: () => props.registry!,
  defaultLayout: () => props.defaultLayout!,
});

provide('dashboard-save-widget-config', saveWidgetConfigDirect);

defineExpose({
  isEditMode,
  isSaving,
  enterEditMode,
  saveLayout,
  cancelEdit,
  revealWidget,
});

async function addAndReveal(widgetId: string) {
  addWidget({ widgetId });
  const added = draftWidgets.value.at(-1);
  if (!added) return;
  await nextTick();
  document.querySelector(`[data-widget-instance="${CSS.escape(added.instanceId ?? added.widgetId)}"]`)?.scrollIntoView({
    block: 'center',
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}

const gridClasses = computed(() => [
  'grid grid-cols-1 gap-4 md:grid-cols-2',
  props.columns === 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-3',
  props.naturalHeight ? 'items-start' : 'md:[grid-auto-rows:24rem] [grid-auto-flow:dense]',
]);
</script>

<template>
  <div>
    <div v-if="isEditMode" class="mb-4">
      <DashboardAddWidgetPanel :available-widgets="availableWidgets" @add="addAndReveal" />
    </div>
    <template v-if="displayWidgets.length === 0">
      <div class="text-muted-foreground flex flex-col items-center justify-center gap-3 py-20">
        <LayoutGridIcon class="size-12 opacity-50" />
        <p class="text-sm">{{ $t('dashboard.editMode.emptyState') }}</p>
      </div>
    </template>

    <!-- Edit mode: draggable grid -->
    <VueDraggable
      v-else-if="isEditMode"
      v-model="draftWidgets"
      handle=".drag-handle"
      :animation="200"
      :delay="150"
      :delay-on-touch-only="true"
      :touch-start-threshold="5"
      :class="gridClasses"
    >
      <DashboardWidgetSlot
        v-for="(widget, index) in draftWidgets"
        :key="widget.instanceId ?? widget.widgetId"
        :widget-config="widget"
        :is-edit-mode="true"
        :can-remove="draftWidgets.length > 1"
        :current-period="currentPeriod"
        :definition="registry?.[widget.widgetId]"
        :natural-height="naturalHeight"
        :columns="columns"
        :can-move-up="index > 0"
        :can-move-down="index < draftWidgets.length - 1"
        @move="(widgetId, direction) => moveWidget({ widgetId, direction })"
        @remove="(widgetId) => removeWidget({ widgetId })"
        @resize="(widgetId, colSpan, rowSpan) => resizeWidget({ widgetId, colSpan, rowSpan })"
        @config-change="(widgetId, key, value) => updateWidgetConfig({ widgetId, key, value })"
        ><template v-if="$slots[widget.widgetId] || $slots.default" #default
          ><slot :name="widget.widgetId" :widget="widget"><slot :widget="widget" /></slot></template
      ></DashboardWidgetSlot>
    </VueDraggable>

    <!-- Normal mode: static grid -->
    <div v-else :class="gridClasses">
      <DashboardWidgetSlot
        v-for="widget in activeWidgets"
        :key="widget.instanceId ?? widget.widgetId"
        :widget-config="widget"
        :is-edit-mode="false"
        :can-remove="false"
        :current-period="currentPeriod"
        :definition="registry?.[widget.widgetId]"
        :natural-height="naturalHeight"
        :columns="columns"
        ><template v-if="$slots[widget.widgetId] || $slots.default" #default
          ><slot :name="widget.widgetId" :widget="widget"><slot :widget="widget" /></slot></template
      ></DashboardWidgetSlot>
    </div>
  </div>
</template>
