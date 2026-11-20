import type { DashboardWidgetConfig } from '@/api/user-settings';
import {
  DEFAULT_DASHBOARD_LAYOUT,
  WIDGET_REGISTRY,
  type WidgetLayoutDefinition,
} from '@/components/widgets/widget-registry';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { useLocalStorage } from '@vueuse/core';
import { cloneDeep } from 'lodash-es';
import { computed, ref, watch, toValue, type MaybeRefOrGetter } from 'vue';

interface LayoutOptions {
  page?: 'income' | 'personalFinance';
  registry?: MaybeRefOrGetter<Record<string, WidgetLayoutDefinition>>;
  defaultLayout?: MaybeRefOrGetter<DashboardWidgetConfig[]>;
}

export function useDashboardLayout(options: LayoutOptions = {}) {
  const { data: settings, patchAsync } = useUserSettings();
  const registry = computed(() => toValue(options.registry) ?? WIDGET_REGISTRY);
  const defaults = computed(() => toValue(options.defaultLayout) ?? DEFAULT_DASHBOARD_LAYOUT);

  const cachedLayout = useLocalStorage<DashboardWidgetConfig[]>(
    options.page ? `dashboard-layout-${options.page}` : 'dashboard-layout',
    defaults.value,
  );

  const isEditMode = ref(false);
  const isSaving = ref(false);
  const draftWidgets = ref<DashboardWidgetConfig[]>([]);
  const revealedWidgets = ref<string[]>([]);
  const includeRevealed = (layout: DashboardWidgetConfig[]) => [
    ...layout,
    ...revealedWidgets.value
      .filter((id) => !layout.some((w) => w.widgetId === id) && registry.value[id])
      .map((id) => {
        const def = registry.value[id]!;
        return { widgetId: id, colSpan: def.defaultColSpan, rowSpan: def.defaultRowSpan };
      }),
  ];

  const activeWidgets = computed<DashboardWidgetConfig[]>(() => {
    const saved = options.page
      ? settings.value?.ui?.pageLayouts?.[options.page]?.widgets
      : settings.value?.dashboard?.widgets;

    if (settings.value) {
      // Settings loaded — use API data or default
      const layout = saved && saved.length > 0 ? saved : defaults.value;
      const known = layout.filter(
        (w, index) => w.widgetId in registry.value && layout.findIndex((x) => x.widgetId === w.widgetId) === index,
      );
      return includeRevealed(known.length ? known : defaults.value);
    }

    // Still loading — use cached layout for accurate skeletons
    const known = cachedLayout.value.filter((w) => w.widgetId in registry.value);
    return includeRevealed(known.length ? known : defaults.value);
  });

  watch(activeWidgets, (layout) => {
    if (settings.value) {
      cachedLayout.value = layout;
    }
  });

  const displayWidgets = computed(() => (isEditMode.value ? draftWidgets.value : activeWidgets.value));

  const availableWidgets = computed(() => {
    const currentIds = new Set(draftWidgets.value.map((w) => w.widgetId));
    return Object.values(registry.value).filter((def) => !currentIds.has(def.id));
  });

  const enterEditMode = () => {
    draftWidgets.value = cloneDeep(activeWidgets.value);
    isEditMode.value = true;
    trackAnalyticsEvent({ event: 'dashboard_edit_opened' });
  };

  const saveLayout = async () => {
    if (isSaving.value || !isEditMode.value) return false;
    isSaving.value = true;
    try {
      await persistWidgets(cloneDeep(draftWidgets.value));
      revealedWidgets.value = [];
      trackAnalyticsEvent({ event: 'dashboard_layout_saved', properties: { widget_count: draftWidgets.value.length } });
      isEditMode.value = false;
      return true;
    } catch {
      // useUserSettings displays the save error; keep the draft available for retry.
      return false;
    } finally {
      isSaving.value = false;
    }
  };

  const persistWidgets = (widgets: DashboardWidgetConfig[]) =>
    options.page
      ? patchAsync({ ui: { pageLayouts: { [options.page]: { widgets } } } })
      : patchAsync({ dashboard: { widgets } });

  const cancelEdit = () => {
    if (isSaving.value) return;
    draftWidgets.value = [];
    isEditMode.value = false;
  };

  const removeWidget = ({ widgetId }: { widgetId: string }) => {
    draftWidgets.value = draftWidgets.value.filter((w) => w.widgetId !== widgetId);
  };

  const addWidget = ({ widgetId }: { widgetId: string }) => {
    const def = registry.value[widgetId];
    if (!def || draftWidgets.value.some((w) => w.widgetId === widgetId)) return;
    draftWidgets.value.push({ widgetId, colSpan: def.defaultColSpan, rowSpan: def.defaultRowSpan });
  };

  const moveWidget = ({ widgetId, direction }: { widgetId: string; direction: -1 | 1 }) => {
    const index = draftWidgets.value.findIndex((w) => w.widgetId === widgetId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= draftWidgets.value.length) return;
    const [widget] = draftWidgets.value.splice(index, 1);
    draftWidgets.value.splice(target, 0, widget!);
  };

  const resizeWidget = ({ widgetId, colSpan, rowSpan }: { widgetId: string; colSpan: number; rowSpan: number }) => {
    const widget = draftWidgets.value.find((w) => w.widgetId === widgetId);
    if (widget) {
      widget.colSpan = colSpan;
      widget.rowSpan = rowSpan;
    }
  };

  const updateWidgetConfig = ({ widgetId, key, value }: { widgetId: string; key: string; value: unknown }) => {
    const widget = draftWidgets.value.find((w) => w.widgetId === widgetId);
    if (widget) {
      widget.config = { ...widget.config, [key]: value };
    }
  };

  const saveWidgetConfigDirect = async ({
    widgetId,
    config,
  }: {
    widgetId: string;
    config: Record<string, unknown>;
  }) => {
    if (!settings.value) return;

    const widgets = cloneDeep(activeWidgets.value);
    const widget = widgets.find((w) => w.widgetId === widgetId);
    if (widget) {
      widget.config = { ...widget.config, ...config };
      await persistWidgets(widgets);
      trackAnalyticsEvent({
        event: 'dashboard_widget_config_saved',
        properties: { widget_id: widgetId },
      });
    }
  };

  return {
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
    revealWidget: (widgetId: string) => {
      if (!revealedWidgets.value.includes(widgetId)) revealedWidgets.value.push(widgetId);
    },
    resizeWidget,
    updateWidgetConfig,
    saveWidgetConfigDirect,
  };
}
