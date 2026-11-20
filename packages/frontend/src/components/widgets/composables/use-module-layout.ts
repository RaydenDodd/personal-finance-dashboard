import { computed, inject, toValue, type MaybeRefOrGetter } from 'vue';

/** Page blocks grow naturally; dashboard tiles share the native grid's fixed height. */
export function useModuleLayout() {
  const bounded = inject<MaybeRefOrGetter<boolean>>('dashboard-widget-bounded', false);
  return { bounded: computed(() => toValue(bounded)) };
}
