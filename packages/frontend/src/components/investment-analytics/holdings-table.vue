<script setup lang="ts">
import { computed, ref } from 'vue';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import SecurityHistory from './security-history.vue';
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
  expanded = ref<string[]>([]);
const historyHolding = ref<InvestmentHolding | null>(null),
  historyOpen = ref(false);
const showHistory = (holding: InvestmentHolding) => {
  historyHolding.value = holding;
  historyOpen.value = true;
};
const unitPrice = (value: string | null, currency: string) =>
  value == null
    ? 'Unknown'
    : new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        maximumFractionDigits: Math.abs(Number(value)) < 1 ? 8 : 4,
      }).format(Number(value));
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
const shown = computed(() => rows.value);
const averageCost = (row: InvestmentHolding) =>
  row.averageCost ?? (row.accounts.length === 1 ? (row.accounts[0]?.reportedAverageCost ?? null) : null);
const money = (value: string | null, currency = props.analytics.currencyCode) =>
  value == null ? 'Unknown' : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value));
const percent = (value: string | null) => (value == null ? 'Unknown' : `${Number(value).toFixed(2)}%`);
const signed = (value: string | null) =>
  value == null ? 'text-muted-foreground' : Number(value) >= 0 ? 'text-app-income-color' : 'text-app-expense-color';
function sortBy(key: string) {
  direction.value = sort.value === key ? -direction.value : -1;
  sort.value = key;
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
      /><span class="text-muted-foreground text-xs">{{ rows.length }} combined positions</span>
    </div>
    <ScrollArea class="h-[min(32rem,65dvh)] min-w-0 rounded-md border">
      <div class="space-y-2 p-2 md:hidden" data-testid="investment-mobile-holdings">
        <article v-for="row in shown" :key="row.id" class="rounded-md border p-3 text-xs">
          <div class="flex min-w-0 items-start justify-between gap-2">
            <div class="min-w-0">
              <strong>{{ row.symbol }}</strong>
              <p class="text-muted-foreground mt-0.5 truncate">{{ row.name }}</p>
            </div>
            <strong class="shrink-0">{{ money(row.marketValue) }}</strong>
          </div>
          <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
            <div>
              <dt class="text-muted-foreground">Units</dt>
              <dd class="break-all" :title="row.quantity">
                {{ Number(row.quantity).toLocaleString(undefined, { maximumFractionDigits: 10 }) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Weight · known assets</dt>
              <dd>{{ percent(row.weight) }}</dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Average cost</dt>
              <dd>
                {{ unitPrice(averageCost(row), row.currencyCode)
                }}<span
                  v-if="row.averageCost === null && averageCost(row) !== null"
                  class="text-muted-foreground block text-[10px]"
                  >Broker display average; tax basis unavailable</span
                >
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Open cost basis</dt>
              <dd>{{ money(row.costBasis) }}</dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Lifetime unrealized</dt>
              <dd :class="signed(row.unrealizedGain)">
                {{ money(row.unrealizedGain) }} · {{ percent(row.unrealizedPercent) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Today's change</dt>
              <dd :class="signed(row.dailyChange)" :title="row.dailyChangeReason">
                {{ money(row.dailyChange) }} · {{ percent(row.dailyChangePercent) }}
              </dd>
            </div>
          </dl>
          <p class="text-muted-foreground mt-3 text-[10px] break-words">
            Price / valuation recorded {{ row.priceDate ?? 'unavailable' }} ·
            {{
              row.quoteStatus === 'closing'
                ? 'Latest close'
                : row.quoteStatus === 'delayed'
                  ? 'Provider quote · may be delayed'
                  : 'Last recorded price'
            }}
          </p>
          <div class="mt-2 flex flex-wrap gap-3">
            <button
              class="text-primary-text underline"
              @click="showHistory(row)"
              :aria-label="'Price history for ' + row.symbol"
            >
              Price history</button
            ><button
              class="text-primary-text underline"
              :aria-label="'Accounts holding ' + row.symbol"
              @click="
                expanded = expanded.includes(row.id) ? expanded.filter((id) => id !== row.id) : [...expanded, row.id]
              "
            >
              {{ row.portfolioCount }} accounts
            </button>
          </div>
          <div v-if="expanded.includes(row.id)" class="mt-2 space-y-2 border-t pt-2">
            <div v-for="account in row.accounts" :key="account.portfolioId" class="break-words">
              <router-link
                :to="{ name: ROUTES_NAMES.portfolioDetail, params: { portfolioId: account.portfolioId } }"
                class="text-primary-text underline"
                >{{ account.portfolioName }}</router-link
              >
              <p>
                Basis {{ money(account.costBasis) }} · average {{ unitPrice(account.averageCost, row.currencyCode) }}
              </p>
            </div>
          </div>
        </article>
      </div>
      <ScrollArea class="hidden min-w-0 md:block" with-horizontal-scrollbar>
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
                    expanded = expanded.includes(row.id)
                      ? expanded.filter((id) => id !== row.id)
                      : [...expanded, row.id]
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
                {{ unitPrice(averageCost(row), row.currencyCode) }}
              </td>
              <td class="p-3 text-right whitespace-nowrap tabular-nums">
                {{ money(row.costBasis)
                }}<span v-if="row.costBasis == null" class="text-muted-foreground block">Incomplete basis</span>
              </td>
              <td class="p-3 text-right whitespace-nowrap tabular-nums">
                {{ unitPrice(row.price, row.currencyCode)
                }}<time class="text-muted-foreground block text-[10px]">{{
                  row.priceDate ?? 'No quote timestamp'
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
                <button
                  class="text-primary-text mb-3 underline"
                  :aria-label="'Price history for ' + row.symbol"
                  @click="showHistory(row)"
                >
                  View {{ row.symbol }} price history
                </button>
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
      </ScrollArea>
      <p v-if="!rows.length" class="text-muted-foreground p-6 text-center text-sm">
        No matching open positions in the selected portfolios.
      </p>
    </ScrollArea>
    <SecurityHistory v-if="historyHolding" v-model="historyOpen" :holding="historyHolding" />
  </div>
</template>
