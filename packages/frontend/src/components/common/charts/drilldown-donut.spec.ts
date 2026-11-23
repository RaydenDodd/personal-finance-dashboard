import { mount } from '@vue/test-utils';
import { it, expect, vi } from 'vitest';
vi.mock('@/components/widgets/expenses-structure/donut-chart.vue', () => ({
  default: { name: 'ExpenseDonut', props: ['data', 'totalAmount'], emits: ['category-click'], template: '<div />' },
}));
import DrilldownDonut from './drilldown-donut.vue';
it('drills into nested pies, survives refreshed data, and returns one level at a time', async () => {
  const data = [
    {
      id: 'taxes',
      name: 'Taxes',
      amount: 100,
      children: [
        { id: 'federal', name: 'Federal', amount: 80, children: [{ id: 'income', name: 'Income tax', amount: 80 }] },
        { id: 'state', name: 'State', amount: 20 },
      ],
    },
  ];
  const w = mount(DrilldownDonut, { props: { data, total: 100, label: 'Income', showLegend: false } });
  const chart = () => w.findComponent({ name: 'ExpenseDonut' });
  chart().vm.$emit('category-click', { categoryId: 'taxes' });
  await w.vm.$nextTick();
  expect(
    chart()
      .props('data')
      .map((r: { name: string }) => r.name),
  ).toEqual(['Federal', 'State']);
  await w.setProps({ data: structuredClone(data) });
  expect(w.get('button').attributes('aria-label')).toBe('Back from Taxes');
  chart().vm.$emit('category-click', { categoryId: 'federal' });
  await w.vm.$nextTick();
  expect(chart().props('data')[0].name).toBe('Income tax');
  await w.get('button').trigger('click');
  expect(chart().props('data')[0].name).toBe('Federal');
  await w.get('button').trigger('click');
  expect(chart().props('data')[0].name).toBe('Taxes');
});
