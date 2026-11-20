<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button } from '@/components/lib/ui/button';
import { ROUTES_NAMES } from '@/routes';
import type { InvestmentAnalytics, InvestmentHolding } from '@bt/shared/types/investment-analytics';
import { chartNumber } from './chart-model';
const props = withDefaults(
  defineProps<{
    analytics: InvestmentAnalytics;
    compact?: boolean;
    limit?: number;
    search?: string;
    securityId?: string;
  }>(),
  { limit: 20 },
);
const query = ref(props.search ?? ''),
  sort = ref('marketValue'),
  direction = ref(-1),
  page = ref(0),
  expanded = ref<string[]>([]);
const rows = computed(() =>
  props.analytics.holdings
    .filter(
      (row) =>
        (!props.securityId || row.securityId === props.securityId || row.symbol === props.securityId) &&
        `${row.symbol} ${row.name} ${row.securityType}`.toLowerCase().includes(query.value.toLowerCase()),
    )
    .sort((a, b) => {
      const key = sort.value as keyof InvestmentHolding;
      return (
        (key === 'symbol'
          ? a.symbol.localeCompare(b.symbol)
          : (chartNumber(a[key]) ?? -Infinity) - (chartNumber(b[key]) ?? -Infinity)) * direction.value
      );
    }),
);
const perPage = computed(() => (props.compact ? Math.min(props.limit, 20) : props.limit));
const shown = computed(() => rows.value.slice(page.value * perPage.value, (page.value + 1) * perPage.value));
const money = (value: string | null, currency = props.analytics.currencyCode) =>
  value == null ? 'Unknown' : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value));
const percent = (value: string | null) => (value == null ? 'Unknown' : `${Number(value).toFixed(2)}%`);
const signed = (value: string | null) =>
  value == null ? 'text-muted-foreground' : Number(value) >= 0 ? 'text-app-income-color' : 'text-app-expense-color';
function sortBy(key: string) {
  direction.value = sort.value === key ? -direction.value : -1;
  sort.value = key;
  page.value = 0;
}
</script>
<template>
  <div class="min-w-0 space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <input
        v-model="query"
        aria-label="Search investment holdings"
        placeholder="Search securities"
        class="border-input bg-background h-8 max-w-full rounded-md border px-3 text-sm"
        @input="page = 0"
      /><span class="text-muted-foreground text-xs">{{ rows.length }} combined positions</span>
    </div>
    <div class="max-h-[32rem] overflow-auto rounded-md border">
      <table class="w-full text-left text-xs" data-testid="investment-holdings-table">
        <thead class="bg-muted/80 text-muted-foreground sticky top-0 z-10">
          <tr>
            <th class="p-3"><button @click="sortBy('symbol')">Security ↕</button></th>
            <th class="p-3 text-right">Shares / units</th>
            <th class="p-3 text-right">Average cost</th>
            <th class="p-3 text-right"><button @click="sortBy('costBasis')">Open cost basis ↕</button></th>
            <th class="p-3 text-right">Latest price</th>
            <th class="p-3 text-right"><button @click="sortBy('marketValue')">Market value ↕</button></th>
            <th class="p-3 text-right"><button @click="sortBy('unrealizedGain')">Unrealized ↕</button></th>
            <th class="p-3 text-right">Realized</th>
            <th class="p-3 text-right">Dividends</th>
            <th class="p-3 text-right">Daily</th>
            <th class="p-3 text-right">Weight</th>
          </tr>
        </thead>
        <tbody v-for="row in shown" :key="row.id" class="divide-border/60 border-b last:border-0">
          <tr class="hover:bg-accent/40">
            <td class="p-3">
              <button
                type="button"
                class="min-w-30 text-left"
                :aria-expanded="expanded.includes(row.id)"
                :aria-label="'Accounts holding ' + row.symbol"
                @click="
                  expanded = expanded.includes(row.id) ? expanded.filter((id) => id !== row.id) : [...expanded, row.id]
                "
              >
                <span class="font-semibold">{{ expanded.includes(row.id) ? '▾' : '▸' }} {{ row.symbol }}</span
                ><span class="text-muted-foreground mt-0.5 block max-w-44 truncate">{{ row.name }}</span
                ><span class="text-muted-foreground block text-[10px]"
                  >{{ row.securityType }} · {{ row.currencyCode }} · {{ row.exchange ?? 'Exchange unknown' }} ·
                  {{ row.portfolioCount }} accounts</span
                >
              </button>
            </td>
            <td class="p-3 text-right whitespace-nowrap tabular-nums">{{ row.quantity }}</td>
            <td class="p-3 text-right whitespace-nowrap tabular-nums">
              {{ money(row.averageCost, row.currencyCode) }}
            </td>
            <td class="p-3 text-right whitespace-nowrap tabular-nums">
              {{ money(row.costBasis)
              }}<span v-if="row.costBasis == null" class="text-muted-foreground block">Incomplete basis</span>
            </td>
            <td class="p-3 text-right whitespace-nowrap tabular-nums">
              {{ money(row.price, row.currencyCode)
              }}<time class="text-muted-foreground block text-[10px]">{{
                row.priceDate?.slice(0, 10) ?? 'No price date'
              }}</time>
            </td>
            <td class="p-3 text-right font-semibold whitespace-nowrap tabular-nums">{{ money(row.marketValue) }}</td>
            <td class="p-3 text-right whitespace-nowrap tabular-nums" :class="signed(row.unrealizedGain)">
              {{ money(row.unrealizedGain) }}<span class="block">{{ percent(row.unrealizedPercent) }}</span>
            </td>
            <td class="p-3 text-right whitespace-nowrap" :class="signed(row.realizedGain)">
              {{ money(row.realizedGain) }}
            </td>
            <td class="p-3 text-right whitespace-nowrap">{{ money(row.dividends) }}</td>
            <td class="p-3 text-right whitespace-nowrap" :class="signed(row.dailyChange)">
              {{ money(row.dailyChange) }}<span class="block">{{ percent(row.dailyChangePercent) }}</span>
            </td>
            <td class="p-3 text-right whitespace-nowrap">{{ percent(row.weight) }}</td>
          </tr>
          <tr v-if="expanded.includes(row.id)">
            <td colspan="11" class="bg-muted/25 px-5 py-3">
              <div
                v-for="account in row.accounts"
                :key="account.portfolioId"
                class="grid min-w-160 grid-cols-[1.2fr_repeat(5,1fr)] items-center gap-3 border-b py-2 last:border-0"
              >
                <router-link
                  :to="{ name: ROUTES_NAMES.portfolioDetail, params: { portfolioId: account.portfolioId } }"
                  class="text-primary-text underline"
                  >{{ account.portfolioName }}</router-link
                ><span>{{ account.quantity }} units</span><span>Basis {{ money(account.costBasis) }}</span
                ><span>Average {{ money(account.averageCost, row.currencyCode) }}</span
                ><span>Value {{ money(account.marketValue) }}</span
                ><span :class="signed(account.unrealizedGain)">Gain {{ money(account.unrealizedGain) }}</span
                ><span class="text-muted-foreground col-span-6"
                  >{{ account.source }} · updated {{ account.updatedAt ?? 'date unavailable' }}</span
                >
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!rows.length" class="text-muted-foreground p-6 text-center text-sm">
        No matching open positions in the selected portfolios.
      </p>
    </div>
    <div class="flex items-center justify-end gap-3 text-xs">
      <Button size="sm" variant="ghost" :disabled="page === 0" @click="page--">Previous</Button
      ><span>{{ page + 1 }} / {{ Math.max(1, Math.ceil(rows.length / perPage)) }}</span
      ><Button size="sm" variant="ghost" :disabled="(page + 1) * perPage >= rows.length" @click="page++">Next</Button>
    </div>
  </div>
</template>
