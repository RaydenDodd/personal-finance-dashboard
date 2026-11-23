// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { it, expect } from 'vitest';
import { h } from 'vue';

import Controls from './widget-header-controls.vue';
import Wrapper from './widget-wrapper.vue';
it('keeps controls beside the title instead of consuming chart-body rows', async () => {
  const w = mount(Wrapper, {
    slots: {
      title: 'Value vs. Invested Capital',
      default: () => h(Controls, null, { default: () => h('button', { 'aria-label': 'Choose period' }, '1M') }),
    },
  });
  await flushPromises();
  expect(w.get('[data-widget-header-controls] button').text()).toBe('1M');
  w.unmount();
});
