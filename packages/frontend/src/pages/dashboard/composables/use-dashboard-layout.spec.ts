import type { DashboardWidgetConfig, UserSettingsSchema } from '@/api/user-settings';
import { DEFAULT_DASHBOARD_LAYOUT } from '@/components/widgets/widget-registry';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const settings = ref<UserSettingsSchema | null>(null);
const patchAsync = vi.fn();

vi.mock('@/composable/data-queries/user-settings', () => ({
  useUserSettings: () => ({ data: settings, patchAsync }),
}));

vi.mock('@/lib/posthog', () => ({ trackAnalyticsEvent: vi.fn() }));

import { pageBlock, defaultPageLayout } from './page-blocks';
import { useDashboardLayout } from './use-dashboard-layout';

describe('shared dashboard editor on finance pages', () => {
  const registry = Object.fromEntries(
    ['summary', 'history', 'allocation'].map((id) => [id, pageBlock(id, id, 'Synthetic layout block')]),
  );
  const defaults = defaultPageLayout(registry);
  beforeEach(() => {
    localStorage.clear();
    settings.value = {
      dashboard: { widgets: [{ widgetId: 'balance-trend', colSpan: 2 }] },
      ui: {
        pageLayouts: { personalFinance: { widgets: [{ widgetId: 'history', colSpan: 3 }] } },
      },
    };
    patchAsync.mockReset().mockResolvedValue({});
  });
  it('saves only the selected page, preserving the main and personal dashboard layouts', async () => {
    const editor = useDashboardLayout({ page: 'income', registry, defaultLayout: defaults });
    editor.enterEditMode();
    editor.moveWidget({ widgetId: 'allocation', direction: -1 });
    editor.moveWidget({ widgetId: 'allocation', direction: -1 });
    editor.resizeWidget({ widgetId: 'allocation', colSpan: 2, rowSpan: 1 });
    expect(await editor.saveLayout()).toBe(true);
    expect(patchAsync).toHaveBeenCalledWith({
      ui: {
        pageLayouts: {
          income: { widgets: [{ widgetId: 'allocation', colSpan: 2, rowSpan: 1 }, defaults[0], defaults[1]] },
        },
      },
    });
    expect(settings.value?.dashboard?.widgets[0]?.widgetId).toBe('balance-trend');
    expect(settings.value?.ui?.pageLayouts?.personalFinance?.widgets[0]?.widgetId).toBe('history');
  });
  it('cancels reorder, removal and size edits without writing settings', () => {
    const editor = useDashboardLayout({ page: 'income', registry, defaultLayout: defaults });
    editor.enterEditMode();
    editor.removeWidget({ widgetId: 'history' });
    editor.moveWidget({ widgetId: 'allocation', direction: -1 });
    editor.cancelEdit();
    expect(editor.displayWidgets.value).toEqual(defaults);
    expect(patchAsync).not.toHaveBeenCalled();
  });
  it('loads a saved page order and can restore a hidden block without duplicating it', () => {
    settings.value!.ui!.pageLayouts!.income = { widgets: [defaults[2]!, defaults[0]!] };
    const editor = useDashboardLayout({ page: 'income', registry, defaultLayout: defaults });
    expect(editor.activeWidgets.value.map((w) => w.widgetId)).toEqual(['allocation', 'summary']);
    editor.enterEditMode();
    editor.addWidget({ widgetId: 'history' });
    editor.addWidget({ widgetId: 'history' });
    expect(editor.draftWidgets.value.map((w) => w.widgetId)).toEqual(['allocation', 'summary', 'history']);
  });
  it('keeps an unsaved draft open when persistence fails', async () => {
    patchAsync.mockRejectedValueOnce(new Error('Offline'));
    const editor = useDashboardLayout({ page: 'income', registry, defaultLayout: defaults });
    editor.enterEditMode();
    editor.moveWidget({ widgetId: 'allocation', direction: -1 });
    expect(await editor.saveLayout()).toBe(false);
    expect(editor.isEditMode.value).toBe(true);
    expect(editor.draftWidgets.value[1]?.widgetId).toBe('allocation');
    expect(editor.isSaving.value).toBe(false);
  });
  it('temporarily reveals a hidden block for an explicit detail action without changing preferences', () => {
    settings.value!.ui!.pageLayouts!.income = { widgets: [defaults[0]!] };
    const editor = useDashboardLayout({ page: 'income', registry, defaultLayout: defaults });
    editor.revealWidget('history');
    expect(editor.activeWidgets.value.map((w) => w.widgetId)).toEqual(['summary', 'history']);
    expect(patchAsync).not.toHaveBeenCalled();
  });
});

describe('useDashboardLayout.saveWidgetConfigDirect', () => {
  beforeEach(() => {
    patchAsync.mockReset();
  });

  it('saves config on top of the default layout when no layout is saved yet', async () => {
    settings.value = { dashboard: { widgets: [] } };
    const widgetId = DEFAULT_DASHBOARD_LAYOUT[0]!.widgetId;

    await useDashboardLayout().saveWidgetConfigDirect({ widgetId, config: { spikesEnabled: false } });

    expect(patchAsync).toHaveBeenCalledTimes(1);
    const { widgets } = patchAsync.mock.calls[0]![0].dashboard;
    expect(widgets).toHaveLength(DEFAULT_DASHBOARD_LAYOUT.length);
    expect(widgets.find((w: DashboardWidgetConfig) => w.widgetId === widgetId).config).toMatchObject({
      spikesEnabled: false,
    });
  });
});
