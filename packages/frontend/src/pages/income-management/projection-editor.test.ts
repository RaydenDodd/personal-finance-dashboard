import { createDefaultIncomePlan } from '@bt/shared/finance-income';
import type { IncomeDocument } from '@bt/shared/types/income-management';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import IncomeSettings from './taxes.vue';

const api = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/api/income-management', () => ({
  getIncomeDashboard: api.load,
  saveIncomeDocument: api.save,
  getIncomeTaxData: async () => ({ rules: [], latestCheck: null, policy: 'Existing tax rules' }),
  refreshIncomeTaxData: vi.fn(),
}));
function document(): IncomeDocument {
  const input = createDefaultIncomePlan();
  input.taxYear = 2026;
  input.annualSalary = 113799.44;
  input.annualBonus = 0;
  input.employerBaseContributionPercent = 4;
  input.employerOtherContributionPercent = 3;
  input.savings = { kind: 'amount', value: 1200, basis: 'takeHome' };
  return {
    revision: 8,
    employers: [],
    paychecks: [],
    plans: [
      {
        id: 'current',
        employerId: null,
        name: 'Saved projection',
        effectiveFrom: null,
        effectiveTo: null,
        evidence: 'estimated',
        notes: 'Original provenance',
        input,
      },
    ],
  };
}
const section = (wrapper: ReturnType<typeof mount>, id: string) => wrapper.get(`[data-testid="projection-step-${id}"]`);
const field = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper
    .findAll('label')
    .find((el) => el.text().startsWith(label))!
    .get('input');
async function editor(props = {}) {
  const wrapper = mount(IncomeSettings, { props });
  await flushPromises();
  return wrapper;
}
describe('guided projection editor', () => {
  beforeEach(() => {
    api.load.mockReset().mockResolvedValue({ document: document() });
    api.save.mockReset().mockImplementation(async (value) => value);
  });
  it('starts at income, advances one section at a time, and permits direct expansion without saving', async () => {
    const wrapper = await editor();
    expect(section(wrapper, 'income').get('button').attributes('aria-expanded')).toBe('true');
    expect(section(wrapper, 'retirement').get('button').attributes('aria-expanded')).toBe('false');
    await field(wrapper, 'Gross Yearly Salary').setValue(120000);
    await section(wrapper, 'income')
      .findAll('button')
      .find((b) => b.text() === 'Continue')!
      .trigger('click');
    await flushPromises();
    expect(section(wrapper, 'income').get('button').attributes('aria-expanded')).toBe('false');
    expect(section(wrapper, 'retirement').get('button').attributes('aria-expanded')).toBe('true');
    await section(wrapper, 'savings').get('button').trigger('click');
    await flushPromises();
    expect(section(wrapper, 'retirement').get('button').attributes('aria-expanded')).toBe('false');
    expect(wrapper.get('input[aria-label="Savings"]').element).toHaveProperty('value', '1200');
    await section(wrapper, 'income').get('button').trigger('click');
    await flushPromises();
    expect(field(wrapper, 'Gross Yearly Salary').element).toHaveProperty('value', '120000');
    expect(api.save).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('saves every original field and metadata, with only explicit edits, then emits saved', async () => {
    const original = document();
    const wrapper = await editor({ planId: 'current', payrollSalary: 113799.66 });
    expect(api.save).not.toHaveBeenCalled();
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Use latest payroll salary')!
      .trigger('click');
    await section(wrapper, 'savings').get('button').trigger('click');
    await flushPromises();
    await wrapper.get('input[aria-label="Savings"]').setValue(2400);
    await wrapper.get('#projection-save').trigger('click');
    await flushPromises();
    const expected = structuredClone(original);
    expected.plans[0]!.input.annualSalary = 113799.66;
    expected.plans[0]!.input.savings.value = 2400;
    expect(api.save).toHaveBeenCalledExactlyOnceWith(expected);
    expect(wrapper.emitted('saved')).toEqual([[]]);
    wrapper.unmount();
  });
  it('cancel discards draft changes and failed saves leave the editor open', async () => {
    const wrapper = await editor();
    await field(wrapper, 'Gross Yearly Salary').setValue(130000);
    api.save.mockRejectedValueOnce(Error('conflict'));
    await wrapper.get('#projection-save').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('saved')).toBeUndefined();
    expect(wrapper.text()).toContain('Unable to save');
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Cancel')!
      .trigger('click');
    expect(wrapper.emitted('cancel')).toEqual([[]]);
    expect(api.save).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it('opens the exact plan shown on the projected page and keeps dates valid', async () => {
    const sample = document();
    sample.plans.push({
      ...sample.plans[0]!,
      id: 'scenario',
      evidence: 'projected',
      input: { ...sample.plans[0]!.input, annualSalary: 150000 },
    });
    api.load.mockResolvedValueOnce({ document: sample });
    const wrapper = await editor({ planId: 'scenario' });
    expect(field(wrapper, 'Gross Yearly Salary').element).toHaveProperty('value', '150000');
    await field(wrapper, 'Starting date').setValue('2026-11-20');
    await field(wrapper, 'Through date').setValue('2026-01-01');
    expect(wrapper.get('#projection-save').attributes('disabled')).toBeDefined();
    expect(api.save).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
