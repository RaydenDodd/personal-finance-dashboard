import { useUserSettings } from '@/composable/data-queries/user-settings';
import { computed } from 'vue';

/** Shared Investments/sidebar visibility, independent of aggregate financial inclusion. */
export const usePortfolioVisibility = () => {
  const { data, patchAsync, isPatching } = useUserSettings();
  const hiddenIds = computed(() => new Set(data.value?.ui?.hiddenPortfolioIds ?? []));
  const isHidden = (id: string) => hiddenIds.value.has(id);
  const setHidden = async (id: string, hidden: boolean) => {
    const next = new Set(hiddenIds.value);
    if (hidden) next.add(id);
    else next.delete(id);
    await patchAsync({ ui: { hiddenPortfolioIds: [...next] } });
  };
  return { hiddenIds, isHidden, setHidden, isPatching };
};
