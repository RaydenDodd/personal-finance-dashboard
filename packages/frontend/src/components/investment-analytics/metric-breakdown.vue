<script setup lang="ts">
import { computed } from 'vue';
import type { InvestmentAnalytics } from '@bt/shared/types/investment-analytics';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/lib/ui/dialog';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
const props = defineProps<{
  analytics: InvestmentAnalytics;
  metric: string;
  label: string;
  value: string | null | undefined;
  reason?: string;
}>();
const open = defineModel<boolean>('open', { required: true });
const money = (value: string | null | undefined) =>
  value == null
    ? 'Not recorded'
    : new Intl.NumberFormat(undefined, { style: 'currency', currency: props.analytics.currencyCode }).format(
        Number(value),
      );
const signed = (value: string | null | undefined) =>
  value == null ? 'text-muted-foreground' : Number(value) >= 0 ? 'text-app-income-color' : 'text-app-expense-color';
const rows = computed(() =>
  props.analytics.portfolios.map((p) => ({
    ...p,
    positions: props.analytics.holdings.flatMap((h) =>
      h.accounts
        .filter((a) => a.portfolioId === p.id)
        .map((a) => ({ ...a, symbol: h.symbol, price: h.price, priceDate: a.updatedAt })),
    ),
  })),
);
function contribution(p: (typeof rows.value)[number]) {
  if (props.metric === 'accountGain') return p.calculation?.accountGain;
  if (props.metric === 'unrealizedGain') return p.calculation?.unrealizedGain;
  if (props.metric === 'costBasis') return p.calculation?.gainBasis;
  if (props.metric === 'netInvested') return p.calculation?.recordedFunding;
  if (props.metric === 'marketValue') return p.marketValue ?? p.calculation?.pricedValue;
  if (props.metric === 'cash') return p.cash;
  if (props.metric === 'securitiesValue') return p.calculation?.pricedValue;
  if (props.metric === 'realizedGain') return p.realizedGain;
  if (props.metric === 'dailyChange') return p.calculation?.dailyChange;
  return null;
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="flex max-h-[85dvh] max-w-3xl flex-col overflow-hidden p-4 sm:p-6"
      data-testid="investment-metric-breakdown"
    >
      <DialogHeader>
        <DialogTitle
          >{{ label }} <span :class="signed(value)" class="ml-2 tabular-nums">{{ money(value) }}</span></DialogTitle
        >
        <DialogDescription>{{
          metric === 'accountGain'
            ? 'Account value − lifetime deposits + withdrawals. Reinvestments remain investment gains.'
            : 'Selected accounts and the records contributing to this value.'
        }}</DialogDescription>
      </DialogHeader>
      <ScrollArea class="min-h-0 flex-1">
        <div class="space-y-3 pr-3">
          <p
            v-if="
              reason && !['unrealizedGain', 'accountGain', 'marketValue', 'costBasis', 'netInvested'].includes(metric)
            "
            class="text-muted-foreground text-xs"
          >
            {{ reason }}
          </p>
          <details v-for="p in rows" :key="p.id" class="rounded-md border p-3" :data-portfolio-id="p.id">
            <summary class="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span class="min-w-0 break-words">{{ p.name }}</span>
              <span class="shrink-0 tabular-nums" :class="signed(contribution(p))">{{ money(contribution(p)) }}</span>
            </summary>
            <dl v-if="p.calculation" class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs tabular-nums">
              <dt class="text-muted-foreground">Priced holdings</dt>
              <dd class="text-right">{{ money(p.calculation.pricedValue) }}</dd>
              <dt class="text-muted-foreground">Cash</dt>
              <dd class="text-right">{{ money(p.cash) }}</dd>
              <dt class="text-muted-foreground">Recorded net deposits</dt>
              <dd class="text-right">{{ money(p.calculation.recordedFunding) }}</dd>
              <dt>Holdings − recorded deposits</dt>
              <dd class="text-right" :class="signed(p.calculation.holdingsLessRecordedFunding)">
                {{ money(p.calculation.holdingsLessRecordedFunding) }}
              </dd>
              <dt class="text-muted-foreground">Holdings with known basis</dt>
              <dd class="text-right">{{ money(p.calculation.gainValue) }}</dd>
              <dt class="text-muted-foreground">Remaining cost basis</dt>
              <dd class="text-right">− {{ money(p.calculation.gainBasis) }}</dd>
              <dt>Unrealized holding gain</dt>
              <dd class="text-right font-medium" :class="signed(p.calculation.unrealizedGain)">
                {{ money(p.calculation.unrealizedGain) }}
              </dd>
            </dl>
            <ul v-if="p.calculation?.missing.length" class="text-muted-foreground mt-3 space-y-1 text-xs">
              <li v-for="missing in p.calculation.missing" :key="missing">{{ missing }}</li>
            </ul>
            <div class="mt-3 divide-y">
              <div v-for="h in p.positions" :key="h.symbol" class="py-2 text-xs" :data-symbol="h.symbol">
                <div class="flex justify-between gap-3">
                  <strong>{{ h.symbol }}</strong
                  ><span
                    :class="signed(metric === 'dailyChange' ? h.dailyChange : h.unrealizedGain)"
                    class="tabular-nums"
                    >{{ money(metric === 'dailyChange' ? h.dailyChange : h.unrealizedGain) }}</span
                  >
                </div>
                <div class="text-muted-foreground mt-1 tabular-nums">
                  {{ h.quantity }} × {{ money(h.price) }} = {{ money(h.marketValue) }}<br />− basis
                  {{ money(h.costBasis) }} · average {{ money(h.averageCost) }}
                </div>
                <div class="text-muted-foreground mt-1 break-words">
                  {{ h.source }}<span v-if="h.priceDate"> · quote {{ new Date(h.priceDate).toLocaleString() }}</span>
                </div>
              </div>
            </div>
          </details>
        </div>
      </ScrollArea>
    </DialogContent>
  </Dialog>
</template>
