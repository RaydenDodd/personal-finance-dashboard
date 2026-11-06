<template>
  <div
    ref="navbarRef"
    class="finance-bottom-bar bg-background border-border relative z-40 w-full shrink-0 border-t pt-1"
    data-testid="mobile-bottom-bar"
  >
    <nav aria-label="Primary navigation" class="mobile-bottom-navigation grid grid-cols-5 gap-0.5 px-1">
      <RouterLink
        v-for="item in items"
        :key="item.routeName"
        :to="{ name: item.routeName }"
        :aria-current="item.active ? 'page' : undefined"
        :class="[
          'flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-0.5 text-[10px] font-medium',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          item.active ? 'bg-primary/10 text-primary-text' : 'text-muted-foreground',
        ]"
      >
        <component :is="item.icon" class="size-5" aria-hidden="true" />
        <span class="max-w-full truncate">{{ item.label }}</span>
      </RouterLink>
      <Sheet v-model:open="moreOpen">
        <SheetTrigger as-child>
          <button
            type="button"
            class="text-muted-foreground flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-0.5 text-[10px] font-medium"
            aria-label="More navigation"
          >
            <MenuIcon class="size-5" aria-hidden="true" />
            <span>More</span>
          </button>
        </SheetTrigger>
        <SheetContent side="bottom" class="h-[85dvh] overflow-y-auto p-0 pb-[env(safe-area-inset-bottom)]">
          <SheetTitle class="sr-only">More navigation</SheetTitle>
          <SheetDescription class="sr-only"
            >Dashboard, recurring payments, settings and all MoneyMatter features.</SheetDescription
          >
          <Sidebar mobile-view />
        </SheetContent>
      </Sheet>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { useCssVarFromElementSize } from '@/composable/use-css-var-from-element-size';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/lib/ui/sheet';
import { ROUTES_NAMES } from '@/routes/constants';
import { ChartColumnIcon, CreditCardIcon, LayersIcon, MenuIcon, WalletIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import Sidebar from './sidebar/index.vue';

const route = useRoute();
const moreOpen = ref(false);
const items = computed(() => [
  {
    routeName: ROUTES_NAMES.personalFinance,
    label: 'Finances',
    icon: WalletIcon,
    active: route.name === ROUTES_NAMES.personalFinance,
  },
  {
    routeName: ROUTES_NAMES.accounts,
    label: 'Accounts',
    icon: LayersIcon,
    active: route.meta.navSection === 'accounts',
  },
  {
    routeName: ROUTES_NAMES.transactions,
    label: 'Transactions',
    icon: CreditCardIcon,
    active: route.meta.navSection === 'transactions',
  },
  {
    routeName: ROUTES_NAMES.analyticsNetWorthHistory,
    label: 'Reports',
    icon: ChartColumnIcon,
    active: route.path.startsWith('/analytics'),
  },
]);
watch(
  () => route.fullPath,
  () => {
    moreOpen.value = false;
  },
);

const { elementRef: navbarRef } = useCssVarFromElementSize({
  cssVars: [{ cssVarName: '--bottom-navbar-height', sizeSource: 'borderBoxSize' }],
});
</script>
