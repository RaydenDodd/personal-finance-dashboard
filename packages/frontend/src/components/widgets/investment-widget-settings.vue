<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { SettingsIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { cloneDeep } from 'lodash-es';
import {
  INVESTMENT_ALLOCATION_MODES,
  INVESTMENT_DATE_RANGES,
  investmentWidgetSettings,
  type InvestmentWidgetKind,
} from './investment-widgets';

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
const allocation = computed(() => ['allocation', 'sector', 'geography'].includes(props.kind));
const hasUnit = computed(() => props.kind === 'performance');
const isDividend = computed(() => ['dividends', 'dividend-calendar'].includes(props.kind));
const hasLimit = computed(() =>
  ['holdings', 'exposure', 'performers', 'concentration', 'dividend-calendar'].includes(props.kind),
);
const dateError = computed(() =>
  draft.value.dateRange === 'custom' &&
  (!draft.value.from || !draft.value.through || String(draft.value.from) > String(draft.value.through))
    ? 'Choose a start date on or before the end date.'
    : '',
);
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

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
  if (dateError.value || props.saving) return;
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
  emit('save', { ...draft.value, benchmarks: [...new Set([...symbols, ...custom])].slice(0, 10) });
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
        <header class="shrink-0 border-b px-4 py-3 text-sm font-medium">{{ title }}</header>
        <div class="min-h-0 space-y-4 overflow-y-auto p-4">
          <fieldset class="space-y-2">
            <legend class="mb-1 text-sm font-medium">Portfolios</legend>
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" :checked="selectedPortfolios.length === 0" @change="draft.portfolioIds = []" /> All
              eligible portfolios
            </label>
            <div class="max-h-36 space-y-2 overflow-y-auto pl-1">
              <label v-for="portfolio in portfolios" :key="portfolio.id" class="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  :checked="selectedPortfolios.includes(portfolio.id)"
                  @change="togglePortfolio(portfolio.id, ($event.target as HTMLInputElement).checked)"
                />
                <span class="min-w-0 truncate">{{ portfolio.name }}</span>
              </label>
            </div>
            <p v-if="!portfolios.length" class="text-muted-foreground text-xs">No eligible portfolios are available.</p>
          </fieldset>

          <label class="block space-y-1 text-sm">
            <span class="font-medium">Date range</span>
            <select v-model="draft.dateRange" :class="fieldClass" aria-label="Widget date range">
              <option v-for="range in INVESTMENT_DATE_RANGES" :key="range" :value="range">
                {{ range === 'custom' ? 'Custom dates' : range }}
              </option>
            </select>
          </label>
          <div v-if="draft.dateRange === 'custom'" class="grid grid-cols-2 gap-2">
            <label class="space-y-1 text-xs"
              >From<input
                v-model="draft.from"
                type="date"
                :max="String(draft.through || today)"
                :class="fieldClass"
                aria-label="Widget start date"
            /></label>
            <label class="space-y-1 text-xs"
              >Through<input
                v-model="draft.through"
                type="date"
                :max="today"
                :min="String(draft.from || '')"
                :class="fieldClass"
                aria-label="Widget end date"
            /></label>
            <p v-if="dateError" class="text-destructive col-span-2 text-xs" role="alert">{{ dateError }}</p>
          </div>

          <label v-if="allocation" class="block space-y-1 text-sm">
            <span class="font-medium">Allocation mode</span>
            <select v-model="draft.allocationMode" :class="fieldClass" aria-label="Allocation mode">
              <option v-for="[value, label] in INVESTMENT_ALLOCATION_MODES" :key="value" :value="value">
                {{ label }}
              </option>
            </select>
          </label>
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
            <label class="block space-y-1 text-sm"
              ><span>Rectangle color</span
              ><select v-model="draft.colorBy" :class="fieldClass" aria-label="Heatmap color">
                <option
                  v-for="[value, label] in [
                    ['daily', 'Daily change'],
                    ['weekly', 'Weekly change'],
                    ['monthly', 'Monthly change'],
                    ['ytd', 'YTD change'],
                    ['1y', 'One-year change'],
                    ['unrealized', 'Unrealized position return'],
                  ]"
                  :key="value"
                  :value="value"
                >
                  {{ label }}
                </option>
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
          <label v-if="isDividend" class="block space-y-1 text-sm"
            ><span>Aggregation</span
            ><select v-model="draft.aggregation" :class="fieldClass" aria-label="Dividend aggregation">
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
          <label v-if="hasUnit" class="block space-y-1 text-sm"
            ><span>Display</span
            ><select v-model="draft.unit" :class="fieldClass" aria-label="Investment display unit">
              <option value="dollars">Dollars</option>
              <option value="percent">Percentage return</option>
            </select></label
          >
          <label v-if="hasLimit" class="block space-y-1 text-sm"
            ><span>Visible rows</span
            ><select v-model.number="draft.limit" :class="fieldClass" aria-label="Visible investment rows">
              <option v-for="count in [5, 10, 20, 50, 100]" :key="count" :value="count">{{ count }}</option>
            </select></label
          >
          <p v-if="saveError" class="text-destructive text-xs" role="alert">{{ saveError }}</p>
        </div>
        <footer class="bg-muted/30 flex shrink-0 justify-end gap-2 border-t p-3">
          <Button type="button" size="sm" variant="ghost" :disabled="saving" @click="emit('update:open', false)"
            >Cancel</Button
          >
          <Button type="submit" size="sm" :disabled="saving || !!dateError">{{
            saving ? 'Saving…' : 'Save settings'
          }}</Button>
        </footer>
      </form>
    </PopoverContent>
  </Popover>
</template>
