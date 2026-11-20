import type { InvestmentFundOverlap } from '@bt/shared/types/investment-analytics';
// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import OverlapDetails from './overlap-details.vue';
const fixture = (): InvestmentFundOverlap => ({
  leftId: 'left',
  rightId: 'right',
  leftSymbol: 'SYNTH-L',
  rightSymbol: 'SYNTH-R',
  weightedOverlap: '8',
  sharedCount: 1,
  coverage: 'partial',
  leftDate: '2026-11-01',
  rightDate: '2026-11-01',
  reason: 'Only reported holdings are comparable.',
  shared: [
    {
      id: 'shared',
      symbol: 'SHARED',
      name: 'Synthetic shared company',
      leftWeight: '8',
      rightWeight: '10',
      combinedValue: null,
    },
  ],
  leftUnique: [{ id: 'only-left', symbol: 'LEFT-ONLY', name: 'Synthetic left company', weight: '4', value: '40' }],
  rightUnique: [{ id: 'only-right', symbol: 'RIGHT-ONLY', name: 'Synthetic right company', weight: '3', value: null }],
  sectorOverlap: {
    weightedOverlap: null,
    status: 'unavailable',
    reason: 'Sector classification taxonomies differ.',
    leftCoverage: '20',
    rightCoverage: '30',
    categories: [],
  },
  countryOverlap: {
    weightedOverlap: '15',
    status: 'partial',
    leftCoverage: '20',
    rightCoverage: '30',
    categories: [{ label: 'United States', leftWeight: '20', rightWeight: '15', overlapWeight: '15' }],
  },
});
const open = (pair = fixture()) => mount(OverlapDetails, { props: { pair, currencyCode: 'USD' } });
const choose = (wrapper: ReturnType<typeof open>, label: string) =>
  wrapper
    .findAll('button')
    .find((button) => button.text() === label)!
    .trigger('click');
describe('fund overlap detail views', () => {
  it('shows company weights as percentage units and keeps missing combined exposure unavailable', () => {
    const wrapper = open();
    expect(wrapper.text()).toContain('8.00% / 10.00%');
    expect(wrapper.text()).not.toContain('800.00%');
    expect(wrapper.text()).toContain('Unavailable');
    expect(wrapper.text()).toContain('Only reported holdings are comparable.');
  });
  it('shows each fund observed-only companies without claiming absence from partial sources', async () => {
    const wrapper = open();
    await choose(wrapper, 'Observed only in SYNTH-L');
    expect(wrapper.text()).toContain('LEFT-ONLY');
    expect(wrapper.text()).not.toContain('RIGHT-ONLY');
    expect(wrapper.text()).toContain('cannot prove that a company is absent');
    await choose(wrapper, 'Observed only in SYNTH-R');
    expect(wrapper.text()).toContain('RIGHT-ONLY');
    expect(wrapper.text()).not.toContain('LEFT-ONLY');
  });
  it('keeps incompatible sector overlap unavailable and shows comparable country weights without normalization', async () => {
    const wrapper = open();
    await choose(wrapper, 'Sector comparison');
    expect(wrapper.text()).toContain('Sector weighted overlap: Unavailable');
    expect(wrapper.text()).toContain('Sector classification taxonomies differ.');
    await choose(wrapper, 'Geographical comparison');
    expect(wrapper.text()).toContain('Issuer-country weighted overlap: 15.00%');
    expect(wrapper.text()).toContain('United States');
    expect(wrapper.text()).toContain('20.00%');
    expect(wrapper.text()).toContain('Unclassified weights are excluded');
  });
});
