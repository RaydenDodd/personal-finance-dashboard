import * as principal from '@/api/personal-finance';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Panel from './principal-review-panel.vue';
vi.mock('@/api/personal-finance', () => ({
  getFinancePrincipalState: vi.fn(),
  confirmPrincipalDestination: vi.fn(),
  reconcilePrincipalTransactions: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
});
describe('contribution evidence review', () => {
  it('flags an unverified payroll date without inventing an amount', async () => {
    vi.mocked(principal.getFinancePrincipalState).mockResolvedValue({
      reviews: [
        {
          id: 'payroll',
          reason: 'Posted Collins contribution not verified',
          details: { accountId: 'retirement', expectedPayDate: '2026-10-30' },
        },
      ],
    });
    const wrapper = mount(Panel, { props: { accounts: [] } });
    await flushPromises();
    expect(wrapper.text()).toContain('2026-10-30');
    expect(wrapper.text()).toContain('Unverified amounts are excluded');
    expect(wrapper.text()).not.toContain('$0');
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('record')?.[0]).toEqual(['retirement', '2026-10-30']);
    wrapper.unmount();
  });
  it('saves an explicitly chosen destination for future matching and reconciles the existing transaction', async () => {
    vi.mocked(principal.getFinancePrincipalState).mockResolvedValue({
      reviews: [
        {
          id: 'review',
          reason: 'Choose a verified destination',
          details: {
            sourceNativeAccountId: 'checking',
            exactDescription: 'M1',
            transactionId: 'existing-bank-row',
            date: '2026-11-06',
          },
        },
      ],
    });
    const wrapper = mount(Panel, {
      props: {
        accounts: [{ id: 'invest', name: 'M1 Investments', categoryId: 'investments' } as principal.FinanceAccount],
      },
    });
    await flushPromises();
    await wrapper.find('select').setValue('invest');
    await wrapper.find('button').trigger('click');
    await flushPromises();
    expect(principal.confirmPrincipalDestination).toHaveBeenCalledWith({
      sourceNativeAccountId: 'checking',
      destinationAccountId: 'invest',
      exactDescription: 'M1',
      effectiveFrom: '2026-11-06',
      isEnabled: true,
    });
    expect(principal.reconcilePrincipalTransactions).toHaveBeenCalledWith(['existing-bank-row']);
    expect(wrapper.emitted('updated')).toHaveLength(1);
    wrapper.unmount();
  });
});
