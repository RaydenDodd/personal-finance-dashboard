import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

const mounted = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/components/widgets/widget-registry', () => ({
  WIDGET_REGISTRY: {
    'investment-allocation': {
      id: 'investment-allocation',
      name: 'Investment Allocation',
      literalLabels: true,
      allowedSizes: [],
      needsPeriod: false,
      component: async () => ({
        __esModule: true,
        default: {
          data: () => ({ expanded: false }),
          mounted: () => {
            mounted.count++;
          },
          template:
            '<button data-testid="widget-state" @click="expanded = !expanded">{{ expanded ? "Expanded" : "Collapsed" }}</button>',
        },
      }),
    },
  },
}));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (value: string) => value }) }));
import DashboardWidgetSlot from './dashboard-widget-slot.vue';

describe('dashboard widget component identity', () => {
  it('keeps widget state and its open controls mounted when saved settings replace the configuration object', async () => {
    mounted.count = 0;
    const widget = {
      widgetId: 'investment-allocation',
      instanceId: 'a',
      colSpan: 1,
      config: { allocationMode: 'sector' },
    };
    const wrapper = mount(DashboardWidgetSlot, {
      props: { widgetConfig: widget, isEditMode: false, canRemove: false },
    });
    await flushPromises();
    await wrapper.get('[data-testid="widget-state"]').trigger('click');
    expect(wrapper.text()).toContain('Expanded');
    await wrapper.setProps({ widgetConfig: { ...widget, config: { allocationMode: 'country' } } });
    await flushPromises();
    expect(wrapper.text()).toContain('Expanded');
    expect(mounted.count).toBe(1);
    wrapper.unmount();
  });
});
