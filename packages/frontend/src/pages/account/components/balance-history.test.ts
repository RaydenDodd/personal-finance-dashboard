import { api } from '@/api/_api';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import BalanceHistory from './balance-history.vue';
vi.mock('@/api/_api', () => ({ api: { get: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
const render = () =>
  mount(BalanceHistory, {
    props: { accountId: 'synthetic-bank' },
    global: {
      plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]],
      stubs: { FinanceChart: true },
    },
  });
describe('native bank account historical balances', () => {
  it('labels combined history and filters actual recorded months without inventing component balances', async () => {
    vi.mocked(api.get).mockResolvedValue({
      label: 'Synthetic checking group',
      grouped: true,
      points: [
        { date: '2024-06-15', balance: 125.25, source: 'imported' },
        { date: '2026-11-05', balance: 200, source: 'bank' },
      ],
    });
    const wrapper = render();
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
    expect(wrapper.text()).toContain('Combined history');
    await wrapper.find('select').setValue('2024-06');
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    expect(wrapper.text()).toContain('2024-06-15');
    expect(wrapper.text()).not.toContain('2026-11-05');
    expect(wrapper.text()).toContain('Imported history');
    wrapper.unmount();
  });
});
