<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Button } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import type { InvestmentFundOverlap } from '@bt/shared/types/investment-analytics';
const props = defineProps<{ pair: InvestmentFundOverlap; currencyCode: string }>();
const view = ref('shared');
watch(
  () => props.pair,
  () => {
    view.value = 'shared';
  },
);
const percent = (value: string | null | undefined) => (value == null ? 'Unavailable' : Number(value).toFixed(2) + '%');
const money = (value: string | null | undefined) =>
  value == null
    ? 'Unavailable'
    : new Intl.NumberFormat(undefined, { style: 'currency', currency: props.currencyCode }).format(Number(value));
const tabs = computed(() => [
  ['shared', 'Shared companies'],
  ['left', 'Observed only in ' + props.pair.leftSymbol],
  ['right', 'Observed only in ' + props.pair.rightSymbol],
  ['sector', 'Sector comparison'],
  ['country', 'Geographical comparison'],
]);
const unique = computed(() => (view.value === 'left' ? (props.pair.leftUnique ?? []) : (props.pair.rightUnique ?? [])));
const classification = computed(() => (view.value === 'sector' ? props.pair.sectorOverlap : props.pair.countryOverlap));
</script>
<template>
  <div class="min-w-0 space-y-3" data-testid="investment-overlap-details">
    <p class="font-semibold">
      {{ pair.leftSymbol }} / {{ pair.rightSymbol }} · {{ pair.sharedCount }} shared companies · {{ pair.coverage }}
    </p>
    <p class="text-muted-foreground">
      Effective {{ pair.leftDate ?? 'unavailable' }} / {{ pair.rightDate ?? 'unavailable' }}.
      {{
        pair.coverage === 'verified'
          ? 'Comparable supplied holdings.'
          : 'Partial coverage limits this comparison; an unreported company may still be present in either fund.'
      }}
    </p>
    <p v-if="pair.reason" class="text-muted-foreground">{{ pair.reason }}</p>
    <div class="flex flex-wrap gap-1" role="group" aria-label="Fund overlap detail views">
      <Button
        v-for="[id, label] in tabs"
        :key="id"
        size="sm"
        :variant="view === id ? 'secondary' : 'ghost'"
        :aria-pressed="view === id"
        class="h-auto min-h-8 max-w-full px-2 py-1 text-xs whitespace-normal"
        @click="view = id!"
        >{{ label }}</Button
      >
    </div>
    <template v-if="view === 'shared'"
      ><p class="text-muted-foreground">
        Weighted company overlap {{ percent(pair.weightedOverlap) }}. Combined exposure includes the selected fund
        positions without their wrappers.
      </p>
      <ScrollArea viewport-class="max-h-64" with-horizontal-scrollbar>
        <div
          v-for="row in pair.shared"
          :key="row.id"
          class="flex flex-wrap items-start justify-between gap-2 border-b py-2 last:border-0"
        >
          <span class="min-w-0"
            ><strong>{{ row.symbol }}</strong> · {{ row.name }}</span
          ><span class="text-right tabular-nums"
            >{{ percent(row.leftWeight) }} / {{ percent(row.rightWeight) }} · {{ money(row.combinedValue) }}</span
          >
        </div>
        <p v-if="!pair.shared.length" class="text-muted-foreground py-2">
          No comparable shared companies are available.
        </p>
      </ScrollArea></template
    >
    <template v-else-if="view === 'left' || view === 'right'"
      ><p class="text-muted-foreground">
        Constituents observed only in {{ view === 'left' ? pair.leftSymbol : pair.rightSymbol }}. Missing or partial
        composition data cannot prove that a company is absent from the other fund.
      </p>
      <ScrollArea viewport-class="max-h-64" with-horizontal-scrollbar>
        <div
          v-for="row in unique"
          :key="row.id"
          class="flex flex-wrap items-start justify-between gap-2 border-b py-2 last:border-0"
        >
          <span
            ><strong>{{ row.symbol }}</strong> · {{ row.name }}</span
          ><span class="text-right tabular-nums">{{ percent(row.weight) }} · {{ money(row.value) }}</span>
        </div>
        <p v-if="!unique.length" class="text-muted-foreground py-2">
          No unique constituents can be established from the available holdings.
        </p>
      </ScrollArea></template
    >
    <template v-else
      ><p class="font-medium">
        {{ view === 'sector' ? 'Sector' : 'Issuer-country' }} weighted overlap:
        {{ percent(classification?.weightedOverlap) }}
        <span class="text-muted-foreground">· {{ classification?.status ?? 'unavailable' }}</span>
      </p>
      <p v-if="classification?.reason" class="text-muted-foreground">{{ classification.reason }}</p>
      <p v-if="classification" class="text-muted-foreground">
        Comparable classification coverage: {{ pair.leftSymbol }} {{ percent(classification.leftCoverage) }} ·
        {{ pair.rightSymbol }} {{ percent(classification.rightCoverage) }}. Unclassified weights are excluded from
        matching and remain uncovered.
      </p>
      <p v-else class="text-muted-foreground">Comparable classification data is unavailable.</p>
      <ScrollArea viewport-class="max-h-64" with-horizontal-scrollbar>
        <div
          class="text-muted-foreground grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(3.5rem,auto))] gap-2 border-b py-2 text-[10px]"
        >
          <span>Category</span><span class="text-right">{{ pair.leftSymbol }}</span
          ><span class="text-right">{{ pair.rightSymbol }}</span
          ><span class="text-right">Overlap</span>
        </div>
        <div
          v-for="row in classification?.categories ?? []"
          :key="row.label"
          class="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(3.5rem,auto))] gap-2 border-b py-2 text-[11px] last:border-0"
        >
          <span class="min-w-0 break-words">{{ row.label }}</span
          ><span class="text-right tabular-nums">{{ percent(row.leftWeight) }}</span
          ><span class="text-right tabular-nums">{{ percent(row.rightWeight) }}</span
          ><span class="text-right tabular-nums">{{ percent(row.overlapWeight) }}</span>
        </div>
      </ScrollArea></template
    >
  </div>
</template>
