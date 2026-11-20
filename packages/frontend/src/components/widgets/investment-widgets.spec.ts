import type { DashboardWidgetConfig, UserSettingsSchema } from '@/api/user-settings';
import { DEFAULT_DASHBOARD_LAYOUT, WIDGET_REGISTRY } from '@/components/widgets/widget-registry';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';

import {
  INVESTMENT_ALLOCATION_MODES,
  INVESTMENT_WIDGETS,
  investmentWidgetKind,
  investmentWidgetSettings,
} from './investment-widgets';

const settings = ref<UserSettingsSchema | null>(null);
const patchAsync = vi.fn();
vi.mock('@/composable/data-queries/user-settings', () => ({ useUserSettings: () => ({ data: settings, patchAsync }) }));
vi.mock('@/lib/posthog', () => ({ trackAnalyticsEvent: vi.fn() }));
import { useDashboardLayout } from '@/pages/dashboard/composables/use-dashboard-layout';

describe('all twenty investment widgets in the native dashboard lifecycle', () => {
  beforeEach(() => {
    localStorage.clear();
    settings.value = { dashboard: { widgets: [{ widgetId: 'balance-trend', colSpan: 2 }] } };
    patchAsync.mockReset().mockImplementation(async (patch) => {
      // Simulate the settings API round trip, including a fresh JSON value on reload.
      settings.value = JSON.parse(JSON.stringify({ ...settings.value, ...patch }));
    });
  });

  it.each(INVESTMENT_WIDGETS)(
    '%s supports addition, independent settings, reorder, resize, save, reload and removal',
    async (kind, name) => {
      const id = `investment-${kind}`;
      const definition = WIDGET_REGISTRY[id]!;
      expect(definition.name).toBe(name);
      expect(definition.allowMultiple).toBe(true);
      expect(definition.component).toBeTypeOf('function');
      expect(investmentWidgetKind(id)).toBe(kind);
      const scope = effectScope();
      const editor = scope.run(() => useDashboardLayout())!;
      editor.enterEditMode();
      expect(editor.availableWidgets.value.some((w) => w.id === id)).toBe(true);
      editor.addWidget({ widgetId: id });
      editor.addWidget({ widgetId: id });
      const [first, second] = editor.draftWidgets.value.filter((w) => w.widgetId === id);
      expect(first!.instanceId).toBeTruthy();
      expect(first!.instanceId).not.toBe(second!.instanceId);
      editor.updateWidgetConfig({ widgetId: first!.instanceId!, key: 'portfolioIds', value: ['portfolio-a'] });
      editor.updateWidgetConfig({ widgetId: first!.instanceId!, key: 'dateRange', value: 'YTD' });
      editor.updateWidgetConfig({
        widgetId: second!.instanceId!,
        key: 'portfolioIds',
        value: ['portfolio-b', 'portfolio-c'],
      });
      editor.updateWidgetConfig({ widgetId: second!.instanceId!, key: 'dateRange', value: 'custom' });
      editor.updateWidgetConfig({ widgetId: second!.instanceId!, key: 'from', value: '2025-01-01' });
      editor.updateWidgetConfig({ widgetId: second!.instanceId!, key: 'through', value: '2025-12-31' });
      editor.resizeWidget({ widgetId: second!.instanceId!, colSpan: 3, rowSpan: 2 });
      editor.moveWidget({ widgetId: second!.instanceId!, direction: -1 });
      expect(await editor.saveLayout()).toBe(true);
      scope.stop();

      const reloadScope = effectScope();
      const reloaded = reloadScope.run(() => useDashboardLayout())!;
      const widgets = reloaded.activeWidgets.value;
      expect(widgets[0]).toEqual({ widgetId: 'balance-trend', colSpan: 2 });
      expect(widgets[1]).toMatchObject({
        instanceId: second!.instanceId,
        colSpan: 3,
        rowSpan: 2,
        config: {
          portfolioIds: ['portfolio-b', 'portfolio-c'],
          dateRange: 'custom',
          from: '2025-01-01',
          through: '2025-12-31',
        },
      });
      expect(widgets[2]).toMatchObject({
        instanceId: first!.instanceId,
        config: { portfolioIds: ['portfolio-a'], dateRange: 'YTD' },
      });
      await reloaded.saveWidgetConfigDirect({ widgetId: second!.instanceId!, config: { allocationMode: 'sector' } });
      const persisted = settings.value!.dashboard!.widgets;
      expect(persisted[1]!.config!.allocationMode).toBe('sector');
      expect(persisted[2]!.config!.allocationMode).toBeUndefined();
      reloaded.enterEditMode();
      reloaded.removeWidget({ widgetId: first!.instanceId! });
      expect(await reloaded.saveLayout()).toBe(true);
      expect(settings.value!.dashboard!.widgets.filter((w: DashboardWidgetConfig) => w.widgetId === id)).toHaveLength(
        1,
      );
      expect(settings.value!.dashboard!.widgets[1]!.instanceId).toBe(second!.instanceId);
      reloadScope.stop();
    },
  );

  it('does not automatically add investment widgets to existing or default dashboards', () => {
    expect(INVESTMENT_WIDGETS).toHaveLength(20);
    expect(new Set(INVESTMENT_WIDGETS.map(([kind]) => kind)).size).toBe(20);
    expect(DEFAULT_DASHBOARD_LAYOUT.every((w) => !w.widgetId.startsWith('investment-'))).toBe(true);
    const scope = effectScope();
    expect(scope.run(() => useDashboardLayout().activeWidgets.value)).toEqual([
      { widgetId: 'balance-trend', colSpan: 2 },
    ]);
    scope.stop();
  });
});

describe('concurrent independent widget settings', () => {
  it('preserves changes made in different widget instances while another save is pending', async () => {
    settings.value = {
      dashboard: {
        widgets: [
          {
            widgetId: 'investment-allocation',
            instanceId: 'first',
            colSpan: 1,
            config: { allocationMode: 'holdings' },
          },
          {
            widgetId: 'investment-allocation',
            instanceId: 'second',
            colSpan: 1,
            config: { allocationMode: 'country' },
          },
        ],
      },
    };
    patchAsync.mockReset().mockImplementation(async (patch) => {
      settings.value = JSON.parse(JSON.stringify({ ...settings.value, ...patch }));
    });
    let completeFirst!: () => void;
    patchAsync.mockImplementationOnce(
      (patch) =>
        new Promise<void>((resolve) => {
          completeFirst = () => {
            settings.value = JSON.parse(JSON.stringify({ ...settings.value, ...patch }));
            resolve();
          };
        }),
    );
    const scope = effectScope();
    const editor = scope.run(() => useDashboardLayout())!;
    const first = editor.saveWidgetConfigDirect({ widgetId: 'first', config: { portfolioIds: ['a'] } });
    const second = editor.saveWidgetConfigDirect({ widgetId: 'second', config: { dateRange: 'YTD' } });
    await Promise.resolve();
    expect(patchAsync).toHaveBeenCalledTimes(1);
    completeFirst();
    await Promise.all([first, second]);
    expect(patchAsync).toHaveBeenCalledTimes(2);
    expect(settings.value!.dashboard!.widgets[0]!.config).toMatchObject({
      allocationMode: 'holdings',
      portfolioIds: ['a'],
    });
    expect(settings.value!.dashboard!.widgets[1]!.config).toMatchObject({
      allocationMode: 'country',
      dateRange: 'YTD',
    });
    scope.stop();
  });
});

describe('investment widget presentation settings', () => {
  it('preserves separate valid settings and all thirteen allocation modes', () => {
    expect(INVESTMENT_ALLOCATION_MODES).toHaveLength(13);
    for (const [allocationMode] of INVESTMENT_ALLOCATION_MODES) {
      expect(investmentWidgetSettings('allocation', { allocationMode }).allocationMode).toBe(allocationMode);
    }
    const stored = {
      portfolioIds: ['a', 'a', 'b'],
      benchmarks: ['QQQ'],
      dateRange: 'custom',
      from: '2024-01-01',
      through: '2024-12-31',
      allocationMode: 'underlying',
      limit: 20,
    };
    const normalized = investmentWidgetSettings('allocation', stored);
    expect(normalized).toMatchObject({ ...stored, portfolioIds: ['a', 'b'] });
    expect(stored.portfolioIds).toEqual(['a', 'a', 'b']);
    expect(investmentWidgetSettings('sector').allocationMode).toBe('sector');
    expect(investmentWidgetSettings('geography').allocationMode).toBe('country');
  });

  it('repairs malformed stored presentation settings without fabricating financial values', () => {
    const normalized = investmentWidgetSettings('heatmap', {
      portfolioIds: ['a', null, 4, ''],
      benchmarks: 'QQQ',
      dateRange: 'invalid',
      limit: -1,
      holdingsMode: 'legal-shares',
      sizeBy: 'invalid',
      colorBy: 'invalid',
    });
    expect(normalized).toMatchObject({
      portfolioIds: ['a'],
      benchmarks: [],
      dateRange: '1Y',
      limit: 10,
      holdingsMode: 'direct',
      sizeBy: 'marketValue',
      colorBy: 'daily',
    });
    expect(normalized.marketValue).toBeUndefined();
    expect(investmentWidgetKind('unknown')).toBeNull();
  });
});
