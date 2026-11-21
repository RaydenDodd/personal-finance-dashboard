<script setup lang="ts">
import type { InvestmentAnalytics } from '@bt/shared/types/investment-analytics';
import CompositionHealth from './composition-health.vue';
defineProps<{ analytics: InvestmentAnalytics }>();
</script>
<template>
  <details class="rounded-lg border px-4 py-3 text-xs">
    <summary class="text-muted-foreground cursor-pointer font-medium">Investment information</summary>
    <div class="mt-3 space-y-3">
      <details>
        <summary class="cursor-pointer">Missing data and next steps</summary>
        <div v-for="row in analytics.health.filter((row) => row.status !== 'verified')" :key="row.id" class="mt-2">
          <p class="font-medium">{{ row.label }}</p>
          <p class="text-muted-foreground">{{ row.detail }}</p>
        </div>
      </details>
      <details>
        <summary class="cursor-pointer">Account history</summary>
        <div v-for="portfolio in analytics.portfolios" :key="portfolio.id" class="mt-2">
          <p class="font-medium">{{ portfolio.name }}</p>
          <p class="text-muted-foreground">
            {{
              portfolio.historyComplete
                ? 'Recorded history available'
                : 'Import opening positions, deposits, withdrawals and trades to complete account returns.'
            }}
          </p>
        </div>
      </details>
      <details>
        <summary class="cursor-pointer">Calculations and coverage</summary>
        <p class="text-muted-foreground mt-2">
          Holding period gains use native opening valuations and recorded net trades, fees and distributions. Percentage
          gains divide by opening value plus purchases. Missing opening positions remain unknown. MAX shows the current
          position's unrealized return.
        </p>
        <p v-for="method in analytics.coverage.methodology" :key="method" class="text-muted-foreground mt-2">
          {{ method }}
        </p>
        <p class="text-muted-foreground mt-2">
          {{ analytics.priceRisk?.methodology }}
        </p>
      </details>
      <CompositionHealth :rows="analytics.composition ?? []" compact />
      <details>
        <summary class="cursor-pointer">Company classifications</summary>
        <p class="text-muted-foreground mt-2">
          Issuer classifications take priority. Missing sectors and industries use cached Yahoo Finance company profiles
          where the instrument identity is verified. Headquarters locations are never substituted for issuer countries.
        </p>
        <p
          v-for="source in [
            ...new Set(analytics.exposure.flatMap((row) => Object.values(row.classificationSources ?? {}))),
          ]"
          :key="source"
          class="text-muted-foreground mt-2 break-words"
        >
          {{ source }}
        </p>
      </details>
      <details>
        <summary class="cursor-pointer">Prices and updates</summary>
        <p class="text-muted-foreground mt-2">
          {{ analytics.refresh.schedule }}
        </p>
      </details>
    </div>
  </details>
</template>
