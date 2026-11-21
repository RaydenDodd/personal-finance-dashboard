<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { api } from '@/api/_api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/lib/ui/dialog';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import type { InvestmentHolding } from '@bt/shared/types/investment-analytics';
import { investmentPriceDate, usEquityMarketOpen } from '@bt/shared/types/investment-market';
import DateRange from '@/pages/income-management/payroll/date-range.vue';
import { payrollRange, type PayrollRange } from '@/pages/income-management/payroll/date-range';
import SeriesChart from './series-chart.vue';

const open = defineModel<boolean>({ default: false });
const props = defineProps<{
  holding: Pick<InvestmentHolding, 'id' | 'symbol' | 'name' | 'securityType' | 'priceDate' | 'currencyCode'>;
}>();
type Quote = { date: string; priceAsOf: string | null; priceClose: number; source: string | null };
const query = useQuery({
  queryKey: computed(() => ['investment-security-prices', props.holding.id]),
  queryFn: async () => {
    const result = await api.get('/investments/prices', { securityId: props.holding.id });
    return [...((result.data ?? result) as Quote[])].sort((a, b) => a.date.localeCompare(b.date));
  },
  enabled: () => open.value,
  staleTime: 300000,
  refetchInterval: () => (usEquityMarketOpen() ? 300000 : false),
  refetchIntervalInBackground: false,
});
const earliest = computed(
  () => query.data.value?.[0]?.date.slice(0, 10) ?? props.holding.priceDate?.slice(0, 10) ?? '2026-01-01',
);
const latestObservation = computed(() => query.data.value?.at(-1));
const range = ref<PayrollRange>(payrollRange('1y'));
const points = computed(() => {
  const rows = (query.data.value ?? []).filter((p) => {
    const day = investmentPriceDate(p.date);
    return day >= range.value.from && day <= range.value.through;
  });
  const intraday = ['1d', '1w'].includes(range.value.preset) && rows.filter((p) => p.priceAsOf).length > 2;
  if (intraday)
    return rows
      .filter((p) => p.priceAsOf)
      .map((p) => ({
        date: p.priceAsOf!,
        values: { price: p.priceClose },
        note: `${p.source ?? 'Stored market data'} · actual recorded observation`,
      }));
  const daily = new Map<string, Quote>();
  for (const p of rows) daily.set(investmentPriceDate(p.date), p);
  return [...daily].map(([date, p]) => ({
    date,
    values: { price: p.priceClose },
    note: `${p.source ?? 'Stored market data'} · recorded daily observation`,
  }));
});
</script>
<template>
  <Dialog v-model:open="open"
    ><DialogContent class="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-4xl flex-col overflow-hidden p-4 sm:p-6">
      <DialogHeader
        ><DialogTitle>{{ holding.symbol }} · price history</DialogTitle></DialogHeader
      >
      <ScrollArea class="min-h-0 min-w-0 flex-1" viewport-class="max-h-[75dvh] [&>div]:!block">
        <div class="space-y-3 pr-1" data-testid="investment-security-history">
          <p class="text-muted-foreground text-xs break-words">
            {{ holding.name }} · {{ holding.currencyCode }} per unit.
            {{
              holding.securityType === 'crypto'
                ? 'Crypto trades continuously.'
                : 'Market quotes may be delayed; mutual funds publish daily NAV.'
            }}
          </p>
          <DateRange v-model="range" :earliest="earliest" subject="investment" compact />
          <p v-if="query.isPending.value" class="text-muted-foreground py-12 text-center text-sm">
            Loading recorded prices…
          </p>
          <p v-else-if="query.isError.value" role="alert" class="text-sm">Price history could not be loaded.</p>
          <SeriesChart
            v-else
            :points="points"
            :series="[{ key: 'price', label: holding.symbol + ' · unit price', color: 'var(--primary)' }]"
            :currency-code="holding.currencyCode"
            :label="holding.symbol + ' recorded price history'"
          />
          <p class="text-muted-foreground text-xs break-words">
            Latest stored market observation
            {{ latestObservation?.priceAsOf ?? latestObservation?.date.slice(0, 10) ?? 'unavailable'
            }}{{
              latestObservation && !latestObservation.priceAsOf ? ' (daily price; exact quote time unavailable)' : ''
            }}. History uses stored provider observations; unsupported intervals remain empty. Short periods use
            recorded intraday observations where available.
          </p>
        </div>
      </ScrollArea>
    </DialogContent></Dialog
  >
</template>
