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
  if (props.metric === 'netInvested') return p.calculation?.principal ?? p.calculation?.recordedFunding;
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
      class="flex h-[85dvh] max-h-[56rem] max-w-3xl flex-col overflow-hidden! p-4 sm:p-6"
      data-testid="investment-metric-breakdown"
    >
      <DialogHeader class="pr-8">
        <DialogTitle
          >{{ label }} <span :class="signed(value)" class="ml-2 tabular-nums">{{ money(value) }}</span></DialogTitle
        >
        <DialogDescription>{{
          metric === 'accountGain'
            ? 'Account value − reconciled net principal. Crypto trading estimates are identified separately.'
            : 'Selected accounts and the records contributing to this value.'
        }}</DialogDescription>
      </DialogHeader>
      <ScrollArea class="min-h-0 flex-1">
        <div class="space-y-3 pr-3">
          <p v-if="reason && metric !== 'accountGain'" class="text-muted-foreground text-xs">
            {{ reason }}
          </p>
          <details v-for="p in rows" :key="p.id" class="rounded-md border p-3" :data-portfolio-id="p.id">
            <summary class="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span class="min-w-0 break-words">{{ p.name }}</span>
              <span class="shrink-0 tabular-nums" :class="signed(contribution(p))"
                ><span
                  v-if="
                    (p.calculation?.estimated && metric === 'accountGain') ||
                    (metric === 'dailyChange' && p.calculation?.daily?.estimated)
                  "
                  >≈ </span
                >{{ money(contribution(p)) }}</span
              >
            </summary>
            <p v-if="p.observationDate" class="text-muted-foreground mt-2 text-xs">
              Holdings / basis record: {{ new Date(p.observationDate).toLocaleString() }}
            </p>
            <dl v-if="p.calculation" class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs tabular-nums">
              <template v-if="['accountGain', 'marketValue', 'netInvested'].includes(metric)">
                <dt>Account value</dt>
                <dd class="text-right">{{ money(p.calculation.currentValue) }}</dd>
                <dt class="text-muted-foreground">Reconciled net principal</dt>
                <dd class="text-right">{{ money(p.calculation.principal) }}</dd>
                <dt>Total account gain</dt>
                <dd class="text-right font-medium" :class="signed(p.calculation.accountGain)">
                  {{ money(p.calculation.accountGain) }}
                </dd>
                <dt class="text-muted-foreground">Imported cash deposits</dt>
                <dd class="text-right">{{ money(p.calculation.importedDeposits) }}</dd>
                <dt class="text-muted-foreground">Imported withdrawals / returns</dt>
                <dd class="text-right">{{ money(p.calculation.importedWithdrawals) }}</dd>
                <dt class="text-muted-foreground">Principal − imported net funding</dt>
                <dd class="text-right">{{ money(p.calculation.principalDifference) }}</dd>
              </template>
              <template v-if="metric === 'dailyChange' && p.calculation.daily">
                <dt>{{ p.calculation.daily.currentDate }} value</dt>
                <dd class="text-right">{{ money(p.calculation.daily.currentValue) }}</dd>
                <dt>
                  {{ p.calculation.daily.previousDate }} value<span v-if="p.calculation.daily.estimated">
                    (inferred)</span
                  >
                </dt>
                <dd class="text-right">{{ money(p.calculation.daily.previousValue) }}</dd>
                <dt>External deposits / withdrawals</dt>
                <dd class="text-right">
                  {{ money(p.calculation.daily.deposits) }} / {{ money(p.calculation.daily.withdrawals) }}
                </dd>
                <dt>Change</dt>
                <dd class="text-right" :class="signed(p.calculation.daily.change)">
                  {{ money(p.calculation.daily.change) }}
                </dd>
              </template>
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
            <p v-if="p.calculation?.valueSource" class="text-muted-foreground mt-2 text-xs break-words">
              {{ p.calculation.valueSource }} · {{ p.calculation.valueAsOf }}<br />{{ p.calculation.principalSource }}
            </p>
            <details
              v-if="p.calculation?.brokerReconciliation"
              class="mt-3 text-xs"
              data-testid="broker-performance-reconciliation"
            >
              <summary class="cursor-pointer">Broker Pie and account reconciliation</summary>
              <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 tabular-nums">
                <dt>Reported investments value</dt>
                <dd class="text-right">{{ money(p.calculation.brokerReconciliation.investmentsValue) }}</dd>
                <dt>Reported cash balance</dt>
                <dd class="text-right">{{ money(p.calculation.brokerReconciliation.reportedCash) }}</dd>
                <dt>Verified external net contributions</dt>
                <dd class="text-right">{{ money(p.calculation.brokerReconciliation.netContributions) }}</dd>
                <dt>Whole-account gain (includes cash)</dt>
                <dd class="text-right" :class="signed(p.calculation.brokerReconciliation.wholeAccountGain)">
                  {{ money(p.calculation.brokerReconciliation.wholeAccountGain) }}
                </dd>
                <dt>Broker Pie net cash flow</dt>
                <dd class="text-right">{{ money(p.calculation.brokerReconciliation.reportedNetCashFlow) }}</dd>
                <dt>Broker market gain</dt>
                <dd class="text-right" :class="signed(p.calculation.brokerReconciliation.reportedMarketGain)">
                  {{ money(p.calculation.brokerReconciliation.reportedMarketGain) }}
                </dd>
                <dt>Broker dividends earned</dt>
                <dd class="text-right">{{ money(p.calculation.brokerReconciliation.reportedDividends) }}</dd>
                <dt>Broker Pie total gain (excludes cash)</dt>
                <dd class="text-right" :class="signed(p.calculation.brokerReconciliation.reportedTotalGain)">
                  {{ money(p.calculation.brokerReconciliation.reportedTotalGain) }}
                </dd>
                <dt>Pie gain − whole-account gain</dt>
                <dd class="text-right">{{ money(p.calculation.brokerReconciliation.gainDifference) }}</dd>
                <dt>Recorded purchases</dt>
                <dd class="text-right">{{ money(p.calculation.brokerReconciliation.purchases) }}</dd>
                <dt>Recorded sale proceeds (not withdrawals)</dt>
                <dd class="text-right">{{ money(p.calculation.brokerReconciliation.sales) }}</dd>
                <dt>Purchases − sales</dt>
                <dd class="text-right">{{ money(p.calculation.brokerReconciliation.netSecurityFlow) }}</dd>
                <dt>Unreconciled Pie-flow difference</dt>
                <dd class="text-right">{{ money(p.calculation.brokerReconciliation.securityFlowDifference) }}</dd>
                <dt>Recorded dividends</dt>
                <dd class="text-right">{{ money(p.calculation.brokerReconciliation.dividends) }}</dd>
                <dt>Broker dividends − recorded dividends</dt>
                <dd class="text-right">{{ money(p.calculation.brokerReconciliation.dividendDifference) }}</dd>
                <dt>Other recorded cash, net of costs</dt>
                <dd class="text-right">{{ money(p.calculation.brokerReconciliation.operatingCash) }}</dd>
                <dt>Reconstructed cash balance</dt>
                <dd class="text-right">{{ money(p.calculation.brokerReconciliation.bookCash) }}</dd>
                <dt>Unreconciled reported cash difference</dt>
                <dd class="text-right">{{ money(p.calculation.brokerReconciliation.cashDifference) }}</dd>
                <dt>Earlier worksheet-ledger principal</dt>
                <dd class="text-right">{{ money(p.calculation.worksheetPrincipal) }}</dd>
              </dl>
              <p class="text-muted-foreground mt-2 break-words">
                {{ p.calculation.brokerReconciliation.source }} · {{ p.calculation.brokerReconciliation.date }}
              </p>
              <p class="text-muted-foreground mt-2">
                Unreconciled differences require M1's detailed Pie movements, distribution history and cash statement.
                They have not been entered as transactions.
              </p>
            </details>
            <details v-if="p.calculation?.operatingCashRecords?.length" class="mt-3 text-xs">
              <summary class="cursor-pointer">
                Fees, refunds, interest and other cash ({{ p.calculation.operatingCashRecords.length }})
              </summary>
              <div v-for="r in p.calculation.operatingCashRecords" :key="r.id" class="border-b py-2 break-words">
                <div class="flex justify-between gap-2">
                  <span>{{ r.date }}</span
                  ><span>{{ money(r.amount) }}</span>
                </div>
                <p class="text-muted-foreground">{{ r.description }}</p>
              </div>
            </details>
            <details v-if="p.calculation?.brokerReconciliation" class="mt-3 text-xs">
              <summary class="cursor-pointer">Recorded dividend transactions</summary>
              <div
                v-for="r in analytics.dividends.filter((d) => d.portfolioId === p.id)"
                :key="r.id"
                class="flex justify-between gap-2 border-b py-2"
              >
                <span>{{ r.date }} · {{ r.symbol }}</span
                ><span>{{ money(r.amount) }}</span>
              </div>
            </details>
            <p v-if="metric === 'dailyChange' && p.calculation?.daily" class="text-muted-foreground mt-2 text-xs">
              {{ p.calculation.daily.method }}<span v-if="p.calculation.daily.estimated"> · Estimated</span>
            </p>
            <dl v-if="p.calculation?.purchaseCostEstimate" class="mt-3 grid grid-cols-2 gap-2 text-xs">
              <dt>Crypto purchases (not deposits)</dt>
              <dd class="text-right">{{ money(p.calculation.purchaseCostEstimate.purchases) }}</dd>
              <dt>Sale proceeds</dt>
              <dd class="text-right">{{ money(p.calculation.purchaseCostEstimate.sales) }}</dd>
              <dt>Estimated net trading capital</dt>
              <dd class="text-right">{{ money(p.calculation.purchaseCostEstimate.netTradingCapital) }}</dd>
              <dt>Estimated trading gain</dt>
              <dd class="text-right" :class="signed(p.calculation.accountGain)">
                {{ money(p.calculation.accountGain) }}
              </dd>
            </dl>
            <details v-if="p.calculation?.principalRecords?.length" class="mt-3 text-xs">
              <summary class="cursor-pointer">Principal evidence ({{ p.calculation.principalRecords.length }})</summary>
              <div v-for="r in p.calculation.principalRecords" :key="r.id" class="border-b py-2 break-words">
                <div class="flex justify-between gap-2">
                  <span>{{ r.date }} · {{ r.type }}</span
                  ><span>{{ money(r.amount) }}</span>
                </div>
                <p class="text-muted-foreground">{{ r.description }}</p>
              </div>
            </details>
            <details v-if="p.calculation?.fundingRecords?.length" class="mt-3 text-xs">
              <summary class="cursor-pointer">Cash-flow records ({{ p.calculation.fundingRecords.length }})</summary>
              <div v-for="r in p.calculation.fundingRecords" :key="r.id" class="border-b py-2 break-words">
                <div class="flex justify-between gap-2">
                  <span>{{ r.date }}</span
                  ><span>{{ money(r.amount) }}</span>
                </div>
                <p class="text-muted-foreground">
                  {{ r.description }}<span v-if="r.excluded"> · {{ r.excluded }}</span>
                </p>
              </div>
            </details>
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
          <details
            v-for="a in ['accountGain', 'marketValue', 'dailyChange'].includes(metric)
              ? analytics.accountValueAdjustments
              : []"
            :key="a.label"
            class="rounded-md border p-3 text-sm"
          >
            <summary class="flex cursor-pointer justify-between gap-3">
              <span>{{ a.label }}<span v-if="a.applied === false"> (excluded)</span></span
              ><span
                class="tabular-nums"
                :class="signed(metric === 'dailyChange' ? a.dailyDifference : a.difference)"
                >{{ money(metric === 'dailyChange' ? a.dailyDifference : a.difference) }}</span
              >
            </summary>
            <dl class="mt-3 grid grid-cols-2 gap-2 text-xs">
              <dt>Reported combined value</dt>
              <dd class="text-right">{{ money(a.value) }}</dd>
              <dt>Component values</dt>
              <dd class="text-right">{{ money(a.componentsValue) }}</dd>
              <dt>Unallocated difference</dt>
              <dd class="text-right">{{ money(a.difference) }}</dd>
              <template v-if="metric === 'dailyChange'"
                ><dt>Previous combined value</dt>
                <dd class="text-right">{{ money(a.previousValue) }}</dd>
                <dt>Combined daily change</dt>
                <dd class="text-right" :class="signed(a.dailyChange)">{{ money(a.dailyChange) }}</dd></template
              >
            </dl>
            <p class="text-muted-foreground mt-2 text-xs break-words">
              {{ a.source }} · {{ a.asOf }}.
              {{
                a.applied === false
                  ? 'Older report; excluded from the current total.'
                  : 'Included in the total; not allocated to an individual account.'
              }}
            </p>
          </details>
        </div>
      </ScrollArea>
    </DialogContent>
  </Dialog>
</template>
