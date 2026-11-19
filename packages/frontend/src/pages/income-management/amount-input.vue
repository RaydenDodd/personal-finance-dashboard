<script setup lang="ts">
import type { AmountInput } from '@bt/shared/finance-income';
const value = defineModel<AmountInput>({ required: true });
defineProps<{
  label: string;
  gross?: number | null;
  net?: number | null;
  takeHome?: number | null;
  dollars?: number | null;
}>();
const percent = (amount: number | null | undefined, base: number | null | undefined) =>
  amount == null || !base ? 'Unavailable' : ((amount / base) * 100).toFixed(2) + '%';
const field = 'border-input bg-background h-10 w-full rounded-md border px-3 text-sm';
</script>
<template>
  <fieldset class="space-y-2">
    <legend class="text-sm font-medium">{{ label }}</legend>
    <div class="grid grid-cols-[1fr_7rem] gap-2">
      <input v-model.number="value.value" type="number" min="0" step="0.01" :aria-label="label" :class="field" />
      <select v-model="value.kind" :aria-label="label + ' input type'" :class="field">
        <option value="amount">Yearly $</option>
        <option value="percent">Percent</option>
      </select>
    </div>
    <select
      v-if="value.kind === 'percent'"
      v-model="value.basis"
      :aria-label="label + ' percentage basis'"
      :class="field"
    >
      <option value="gross">% of Gross</option>
      <option value="net">% of Net</option>
      <option value="takeHome">% of Take Home</option>
    </select>
    <p v-if="dollars != null" class="text-muted-foreground text-xs leading-5">
      ${{ dollars.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} / year · {{ percent(dollars, gross) }} of
      Gross · {{ percent(dollars, net) }} of Net · {{ percent(dollars, takeHome) }} of Take Home
    </p>
  </fieldset>
</template>
