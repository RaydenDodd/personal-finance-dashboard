<script setup lang="ts">
import { useDashboardPeriod } from './composables/use-dashboard-period';
import { Button } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { SettingsIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { cloneDeep } from 'lodash-es';
import { INVESTMENT_PERFORMER_PERIODS } from '@/components/investment-analytics/performers-model';
import { investmentWidgetSettings, type InvestmentWidgetKind } from './investment-widgets';

const { dashboardRange } = useDashboardPeriod();
const props = withDefaults(
  defineProps<{
    open: boolean;
    kind: InvestmentWidgetKind;
    settings: Record<string, unknown>;
    portfolios: { id: string; name: string }[];
    saving?: boolean;
    saveError?: string;
    title?: string;
  }>(),
  { title: 'Investment widget settings' },
);
const emit = defineEmits<{
  'update:open': [open: boolean];
  save: [settings: Record<string, unknown>];
}>();
const draft = ref<Record<string, unknown>>({});
const customBenchmarks = ref('');
const selectedPortfolios = computed(() => (draft.value.portfolioIds as string[]) ?? []);
const hasUnit = computed(() => props.kind === 'performance');
const isDividend = computed(() => ['dividends', 'dividend-calendar'].includes(props.kind));
const hasLimit = computed(() => ['exposure', 'performers', 'concentration', 'dividend-calendar'].includes(props.kind));

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    draft.value = cloneDeep(investmentWidgetSettings(props.kind, props.settings));
    customBenchmarks.value = (draft.value.benchmarks as string[])
      .filter((s) => !['SPY', 'QQQ', 'VTI', 'VT'].includes(s))
      .join(', ');
  },
  { immediate: true },
);

const togglePortfolio = (id: string, checked: boolean) => {
  draft.value.portfolioIds = checked
    ? [...new Set([...selectedPortfolios.value, id])]
    : selectedPortfolios.value.filter((p) => p !== id);
};
const toggleBenchmark = (symbol: string, checked: boolean) => {
  const symbols = (draft.value.benchmarks as string[]) ?? [];
  draft.value.benchmarks = checked ? [...new Set([...symbols, symbol])] : symbols.filter((s) => s !== symbol);
};
const save = () => {
  if (props.saving) return;
  if (draft.value.dateRange !== props.settings.dateRange && draft.value.dateRange !== 'custom') {
    // A newly chosen preset supplies its own dates; shifted/custom dates belong
    // only to the preceding selection.
    draft.value.from = undefined;
    draft.value.through = undefined;
  }
  const symbols = ((draft.value.benchmarks as string[]) ?? []).filter((s) => ['SPY', 'QQQ', 'VTI', 'VT'].includes(s));
  const custom = customBenchmarks.value
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9.^=:/-]{1,30}$/.test(s));
  emit('save', {
    ...draft.value,
    benchmarks: [...new Set([...symbols, ...custom])].slice(0, 10),
  });
};
const fieldClass = 'bg-background border-input min-h-9 w-full rounded-md border px-2 text-sm';
</script>

<template>
  <Popover :open="open" @update:open="emit('update:open', $event)">
    <PopoverTrigger as-child>
      <Button variant="ghost" size="icon-sm" :aria-label="title" data-testid="investment-widget-settings">
        <SettingsIcon class="text-muted-foreground size-4" />
      </Button>
    </PopoverTrigger>
    <PopoverContent
      class="flex max-h-[min(80dvh,var(--reka-popover-content-available-height))] w-[min(23rem,calc(100vw-2rem))] flex-col overflow-hidden p-0"
      align="end"
      :collision-padding="12"
    >
      <form class="flex min-h-0 flex-1 flex-col" @submit.prevent="save">
        <header class="shrink-0 border-b px-4 py-3 text-sm font-medium">
          {{ title }}
        </header>
        <ScrollArea class="min-h-0 flex-1" viewport-class="max-h-[min(55dvh,28rem)]"
          ><div class="space-y-4 p-4">
            <fieldset v-if="kind !== 'performance'" class="space-y-2">
              <legend class="mb-1 text-sm font-medium">Portfolios</legend>
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" :checked="selectedPortfolios.length === 0" @change="draft.portfolioIds = []" />
                All eligible portfolios
              </label>
              <ScrollArea class="h-36" viewport-class="space-y-2 pl-1 pr-3">
                <label v-for="portfolio in portfolios" :key="portfolio.id" class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    :checked="selectedPortfolios.includes(portfolio.id)"
                    @change="togglePortfolio(portfolio.id, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="min-w-0 truncate">{{ portfolio.name }}</span>
                </label>
              </ScrollArea>
              <p v-if="!portfolios.length" class="text-muted-foreground text-xs">
                No eligible portfolios are available.
              </p>
            </fieldset>

            <template v-if="kind === 'heatmap'">
              <label class="block space-y-1 text-sm"
                ><span>Holdings mode</span
                ><select v-model="draft.holdingsMode" :class="fieldClass" aria-label="Heatmap holdings mode">
                  <option value="direct">Direct holdings</option>
                  <option value="underlying">Underlying company exposure</option>
                </select></label
              >
              <label class="block space-y-1 text-sm"
                ><span>Group by</span
                ><select v-model="draft.grouping" :class="fieldClass" aria-label="Heatmap grouping">
                  <option
                    v-for="[value, label] in [
                      ['security', 'Security'],
                      ['sector', 'Sector'],
                      ['industry', 'Industry'],
                      ['brokerage', 'Brokerage'],
                      ['country', 'Country'],
                      ['region', 'Region'],
                      ['assetClass', 'Asset class'],
                      ['accountType', 'Account type'],
                    ]"
                    :key="value"
                    :value="value"
                  >
                    {{ label }}
                  </option>
                </select></label
              >
              <label class="block space-y-1 text-sm"
                ><span>Rectangle size</span
                ><select v-model="draft.sizeBy" :class="fieldClass" aria-label="Heatmap rectangle size">
                  <option value="marketValue">Market value</option>
                  <option value="costBasis">Remaining cost basis</option>
                  <option value="absoluteGain">Absolute unrealized gain / loss</option>
                </select></label
              >
            </template>
            <fieldset v-if="kind === 'benchmark'" class="space-y-2">
              <legend class="mb-1 text-sm font-medium">Benchmarks</legend>
              <label
                v-for="[symbol, name] in [
                  ['SPY', 'S&P 500 (SPY)'],
                  ['QQQ', 'Nasdaq-100 (QQQ)'],
                  ['VTI', 'Total US stock market (VTI)'],
                  ['VT', 'Total world stock market (VT)'],
                ]"
                :key="symbol"
                class="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  :checked="((draft.benchmarks as string[]) ?? []).includes(symbol!)"
                  @change="toggleBenchmark(symbol!, ($event.target as HTMLInputElement).checked)"
                />{{ name }}
              </label>
              <label class="block space-y-1 text-sm"
                ><span>Other benchmark symbols</span
                ><input
                  v-model="customBenchmarks"
                  type="text"
                  :class="fieldClass"
                  placeholder="DIA, ^RUT"
                  aria-label="Custom benchmark symbols"
                /><span class="text-muted-foreground text-xs"
                  >Comma separated. Available data may be price only.</span
                ></label
              >
            </fieldset>
            <label v-if="isDividend || kind === 'contributions'" class="block space-y-1 text-sm"
              ><span>Aggregation</span
              ><select
                v-model="draft.aggregation"
                :class="fieldClass"
                :aria-label="kind === 'contributions' ? 'Contribution aggregation' : 'Dividend aggregation'"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select></label
            >
            <label v-if="isDividend || kind === 'holdings' || kind === 'performers'" class="block space-y-1 text-sm"
              ><span>Security filter</span
              ><input
                v-model="draft.securityId"
                :class="fieldClass"
                placeholder="All securities"
                aria-label="Widget security filter"
            /></label>
            <label v-if="hasUnit && !dashboardRange" class="block space-y-1 text-sm"
              ><span>Display</span
              ><select v-model="draft.unit" :class="fieldClass" aria-label="Investment display unit">
                <option value="dollars">Account value ($)</option>
                <option value="gains">Gain / loss ($)</option>
                <option value="percent">Percentage return</option>
              </select></label
            >

            <p v-if="saveError" class="text-destructive text-xs" role="alert">
              {{ saveError }}
            </p>
          </div></ScrollArea
        >
        <footer class="bg-muted/30 flex shrink-0 justify-end gap-2 border-t p-3">
          <Button type="button" size="sm" variant="ghost" :disabled="saving" @click="emit('update:open', false)"
            >Cancel</Button
          >
          <Button type="submit" size="sm" :disabled="saving">{{ saving ? 'Saving…' : 'Save settings' }}</Button>
        </footer>
      </form>
    </PopoverContent>
  </Popover>
</template>
