import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import InvestmentWidgetSettings from './investment-widget-settings.vue';

const stubs = {
  Popover: { template: '<div><slot /></div>' },
  PopoverTrigger: { template: '<div><slot /></div>' },
  PopoverContent: { template: '<div><slot /></div>' },
  Button: { template: '<button><slot /></button>' },
};
const create = (kind: 'allocation' | 'benchmark' | 'heatmap' = 'allocation', settings = {}) =>
  mount(InvestmentWidgetSettings, {
    props: {
      open: true,
      kind,
      settings,
      portfolios: [
        { id: 'a', name: 'Broker A' },
        { id: 'b', name: 'Broker B' },
      ],
    },
    global: { stubs },
  });

describe('investment widget settings controls', () => {
  it('saves portfolios without repeating the allocation selector from the header', async () => {
    const original = { portfolioIds: ['a'], allocationMode: 'sector' };
    const wrapper = create('allocation', original);
    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    await checkboxes[2]!.setValue(true);
    expect(wrapper.find('select[aria-label="Allocation mode"]').exists()).toBe(false);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('save')!.at(-1)![0]).toMatchObject({ portfolioIds: ['a', 'b'], allocationMode: 'sector' });
    expect(original).toEqual({ portfolioIds: ['a'], allocationMode: 'sector' });
    wrapper.unmount();
  });

  it('keeps dates in the header picker and preserves them when unrelated options are saved', async () => {
    const wrapper = create('benchmark', { dateRange: 'custom', from: '2025-07-01', through: '2025-12-31' });
    expect(wrapper.find('select[aria-label="Widget date range"]').exists()).toBe(false);
    expect(wrapper.find('input[aria-label="Widget start date"]').exists()).toBe(false);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('save')![0]![0]).toMatchObject({
      dateRange: 'custom',
      from: '2025-07-01',
      through: '2025-12-31',
    });
    wrapper.unmount();
  });

  it('saves multiple market benchmarks and sanitized custom symbols', async () => {
    const wrapper = create('benchmark', { benchmarks: ['QQQ', 'DIA'] });
    await wrapper.get('input[aria-label="Custom benchmark symbols"]').setValue('dia, ^RUT, QQQ, invalid script!, vt');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('save')![0]![0]).toMatchObject({ benchmarks: ['QQQ', 'DIA', '^RUT', 'VT'] });
    wrapper.unmount();
  });

  it('retains independent heatmap grouping, color, size and holdings settings', async () => {
    const wrapper = create('heatmap');
    await wrapper.get('select[aria-label="Heatmap holdings mode"]').setValue('underlying');
    await wrapper.get('select[aria-label="Heatmap grouping"]').setValue('country');
    await wrapper.get('select[aria-label="Heatmap rectangle size"]').setValue('absoluteGain');
    expect(wrapper.find('select[aria-label="Heatmap color"]').exists()).toBe(false);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('save')![0]![0]).toMatchObject({
      holdingsMode: 'underlying',
      grouping: 'country',
      sizeBy: 'absoluteGain',
      colorBy: 'daily',
    });
    wrapper.unmount();
  });
});
