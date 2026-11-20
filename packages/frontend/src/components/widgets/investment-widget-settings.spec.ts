import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import InvestmentWidgetSettings from './investment-widget-settings.vue';
import { INVESTMENT_ALLOCATION_MODES } from './investment-widgets';

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
  it('saves selected portfolios and any of the thirteen modes without modifying the source settings', async () => {
    const original = { portfolioIds: ['a'], allocationMode: 'sector' };
    const wrapper = create('allocation', original);
    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    await checkboxes[2]!.setValue(true);
    const select = wrapper.get('select[aria-label="Allocation mode"]');
    expect(select.findAll('option')).toHaveLength(13);
    for (const [mode] of INVESTMENT_ALLOCATION_MODES) {
      await select.setValue(mode);
      await wrapper.get('form').trigger('submit');
      expect(wrapper.emitted('save')!.at(-1)![0]).toMatchObject({ portfolioIds: ['a', 'b'], allocationMode: mode });
    }
    expect(original).toEqual({ portfolioIds: ['a'], allocationMode: 'sector' });
    await checkboxes[0]!.setValue(true);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('save')!.at(-1)![0]).toMatchObject({ portfolioIds: [] });
    wrapper.unmount();
  });

  it('validates custom dates and retains exact recorded period selections', async () => {
    const wrapper = create();
    await wrapper.get('select[aria-label="Widget date range"]').setValue('custom');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('save')).toBeUndefined();
    await wrapper.get('input[aria-label="Widget start date"]').setValue('2025-07-01');
    await wrapper.get('input[aria-label="Widget end date"]').setValue('2025-06-30');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('save')).toBeUndefined();
    expect(wrapper.text()).toContain('Choose a start date on or before the end date.');
    await wrapper.get('input[aria-label="Widget end date"]').setValue('2025-12-31');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('save')![0]![0]).toMatchObject({
      dateRange: 'custom',
      from: '2025-07-01',
      through: '2025-12-31',
    });
    wrapper.unmount();
  });

  it('clears dates belonging to an earlier period when a different preset is selected', async () => {
    const wrapper = create('allocation', { dateRange: '1Y', from: '2024-01-01', through: '2024-12-31' });
    await wrapper.get('select[aria-label="Widget date range"]').setValue('MAX');
    await wrapper.get('form').trigger('submit');
    const saved = wrapper.emitted('save')![0]![0] as Record<string, unknown>;
    expect(saved.dateRange).toBe('MAX');
    expect(saved.from).toBeUndefined();
    expect(saved.through).toBeUndefined();
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
    await wrapper.get('select[aria-label="Heatmap color"]').setValue('monthly');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('save')![0]![0]).toMatchObject({
      holdingsMode: 'underlying',
      grouping: 'country',
      sizeBy: 'absoluteGain',
      colorBy: 'monthly',
    });
    wrapper.unmount();
  });
});
