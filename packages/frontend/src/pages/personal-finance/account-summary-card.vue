<script setup lang="ts">
import type { FinanceAccount, FinanceCategory } from '@/api/personal-finance';
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { ROUTES_NAMES } from '@/routes/constants';
import { accountManagementLabel, valuationSourceLabel } from './balance-display';

defineProps<{
  account: FinanceAccount;
  category?: FinanceCategory;
  nativeAccounts: Array<{ id: string; name: string }>;
}>();
defineEmits<{ history: []; record: []; edit: [] }>();
const money = (value: number | null | undefined, currency: string) =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
</script>

<template>
  <Card data-testid="finance-account-card" :class="['min-w-0 p-4', !account.included && 'opacity-60']">
    <button
      type="button"
      class="focus-visible:ring-ring grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded text-left focus-visible:ring-2 focus-visible:outline-none"
      :aria-label="`View ${account.name} balance history`"
      @click="$emit('history')"
    >
      <span class="min-w-0">
        <span class="block font-medium break-words">{{ account.name }}</span>
        <span class="text-muted-foreground mt-1 flex items-center gap-2 text-xs"
          ><span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: category?.color }" />{{
            category?.name
          }}</span
        >
      </span>
      <span class="text-right text-lg font-semibold tabular-nums"
        >{{ money(account.latestBalance, account.currencyCode)
        }}<span v-if="account.latestBalance === null" class="text-warning-text block text-xs font-normal"
          >Missing balance</span
        ></span
      >
    </button>
    <p class="text-muted-foreground mt-2 text-xs">
      {{ account.balanceKind === 'liability' ? 'Liability' : 'Asset' }} ·
      {{ account.included ? 'Included' : 'Excluded from net worth' }} · {{ accountManagementLabel(account) }}
    </p>
    <div class="text-muted-foreground mt-3 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
      <span>Valued {{ account.valuationDate ?? 'Not recorded' }}</span>
      <span
        >{{ valuationSourceLabel(account.valuationSource ?? account.preferredSource)
        }}{{ account.verified ? ' · verified' : '' }}</span
      >
    </div>
    <p
      v-if="account.staleDays !== null && account.staleDays !== undefined && account.staleDays > 7"
      class="text-warning-text mt-1 text-xs"
    >
      {{ account.staleDays }} days old
    </p>
    <p v-if="account.connectionStatus === 'disconnected'" class="text-warning-text mt-1 text-xs">
      Connection disconnected; manual records remain available
    </p>
    <p v-if="account.lastSuccessfulSyncAt" class="text-muted-foreground mt-1 text-xs">
      Last sync {{ account.lastSuccessfulSyncAt.slice(0, 10) }}
    </p>
    <details v-if="account.nativeAccountIds?.length" class="mt-2 text-xs">
      <summary class="text-muted-foreground min-h-11 cursor-pointer py-3">Linked bank accounts</summary>
      <RouterLink
        v-for="nativeId in account.nativeAccountIds"
        :key="nativeId"
        :to="{ name: ROUTES_NAMES.account, params: { id: nativeId } }"
        class="flex min-h-11 items-center py-2 underline underline-offset-4"
        >{{ nativeAccounts.find((a) => a.id === nativeId)?.name ?? 'MoneyMatter account' }}</RouterLink
      >
    </details>
    <dl
      v-if="
        (account.principal !== null && account.principal !== undefined) ||
        (account.knownPrincipal !== null && account.knownPrincipal !== undefined)
      "
      class="mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-sm"
    >
      <div class="min-w-0">
        <dt class="text-muted-foreground text-xs">Net principal at valuation</dt>
        <dd class="mt-1 font-medium tabular-nums">
          {{ money(account.principal ?? account.knownPrincipal, account.currencyCode) }}
        </dd>
        <dd v-if="account.principalEstimated" class="text-muted-foreground mt-1 text-xs">
          Includes accepted estimates
        </dd>
        <dd v-if="account.principalDatesIncomplete" class="text-muted-foreground mt-1 text-xs">
          Historical amounts accepted; dates incomplete
        </dd>
        <dd v-if="account.principal === null" class="text-muted-foreground mt-1 text-xs">
          Recorded basis; later contributions need verification
        </dd>
      </div>
      <div class="min-w-0 text-right">
        <dt class="text-muted-foreground text-xs">Gain / growth</dt>
        <dd
          :class="[
            'mt-1 font-medium tabular-nums',
            account.gain !== null && account.gain !== undefined && account.gain < 0
              ? 'text-app-expense-color'
              : 'text-app-income-color',
          ]"
        >
          {{ money(account.gain, account.currencyCode) }}
        </dd>
        <dd class="text-muted-foreground mt-1 text-xs">{{ percent(account.gainPercent) }}</dd>
        <dd
          v-if="account.principalEstimated || account.principalDatesIncomplete"
          class="text-muted-foreground mt-1 text-xs"
        >
          Relative to recorded principal
        </dd>
      </div>
    </dl>
    <div class="mt-3 grid grid-cols-3 gap-1 border-t pt-2">
      <Button variant="ghost" class="min-h-11 px-2" @click="$emit('history')">History</Button>
      <Button
        variant="ghost"
        class="min-h-11 px-2"
        :aria-label="`Record ${account.name} balance`"
        @click="$emit('record')"
        >Record</Button
      >
      <Button variant="ghost" class="min-h-11 px-2" :aria-label="`Edit ${account.name}`" @click="$emit('edit')"
        >Edit</Button
      >
    </div>
  </Card>
</template>
