<script setup lang="ts">
import { ref } from 'vue';
import type { DashboardWidgetConfig, DashboardPage } from '@/api/user-settings';
import type { WidgetLayoutDefinition } from '@/components/widgets/widget-registry';
import DashboardGrid from './dashboard-grid.vue';
import DashboardEditToolbar from './dashboard-edit-toolbar.vue';

defineProps<{
  page: DashboardPage;
  registry: Record<string, WidgetLayoutDefinition>;
  defaultLayout: DashboardWidgetConfig[];
  columns?: 3 | 4;
}>();
const grid = ref<InstanceType<typeof DashboardGrid> | null>(null);
defineExpose({ revealWidget: (id: string) => grid.value?.revealWidget(id) });
</script>
<template>
  <div class="space-y-4" :data-page-layout="page">
    <slot name="toolbar" :grid="grid">
      <div class="bg-background/95 sticky top-(--header-height) z-(--z-navbar) flex justify-end py-2 backdrop-blur-sm">
        <DashboardEditToolbar
          :is-edit-mode="grid?.isEditMode ?? false"
          :is-saving="grid?.isSaving"
          @enter="grid?.enterEditMode()"
          @save="grid?.saveLayout()"
          @cancel="grid?.cancelEdit()"
        />
      </div>
    </slot>
    <DashboardGrid
      ref="grid"
      :page="page"
      :registry="registry"
      :default-layout="defaultLayout"
      :columns="columns"
      natural-height
    >
      <template v-for="(_, name) in $slots" #[name]="slotProps"><slot :name="name" v-bind="slotProps" /></template>
    </DashboardGrid>
    <DashboardEditToolbar
      v-if="grid?.isEditMode"
      class="bg-background/95 sticky bottom-0 z-(--z-navbar) justify-center border-t py-3 backdrop-blur-sm md:hidden"
      :is-edit-mode="true"
      :is-saving="grid.isSaving"
      @save="grid.saveLayout()"
      @cancel="grid.cancelEdit()"
    />
  </div>
</template>
