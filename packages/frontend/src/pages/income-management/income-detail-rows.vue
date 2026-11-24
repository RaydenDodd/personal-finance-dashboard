<script setup lang="ts">
import { ref } from 'vue';
import type { IncomeDetail } from './income-allocation';
defineProps<{ rows: IncomeDetail[] }>();
const expanded = ref<string[]>([]);
const money = (n: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
function toggle(id: string) {
  expanded.value = expanded.value.includes(id) ? expanded.value.filter((key) => key !== id) : [...expanded.value, id];
}
</script>
<template>
  <div class="divide-border/50 divide-y">
    <div v-for="row in rows" :key="row.id" :style="{ borderLeft: row.color ? '2px solid ' + row.color : undefined }">
      <button
        v-if="row.children.length"
        type="button"
        class="hover:bg-accent focus-visible:bg-accent flex w-full justify-between gap-4 px-4 py-3 text-left text-sm transition-colors"
        :aria-expanded="expanded.includes(row.id)"
        @click="toggle(row.id)"
      >
        <span>{{ row.name }}</span
        ><span class="shrink-0 tabular-nums">{{ money(row.amount) }}</span>
      </button>
      <div v-else class="flex justify-between gap-4 px-4 py-3 text-sm">
        <span class="text-muted-foreground">{{ row.name }}</span
        ><span class="shrink-0 tabular-nums">{{ money(row.amount) }}</span>
      </div>
      <p v-if="row.note" class="text-muted-foreground px-4 pb-3 text-xs">{{ row.note }}</p>
      <IncomeDetailRows v-if="expanded.includes(row.id)" :rows="row.children" class="border-border/50 ml-4 border-l" />
    </div>
  </div>
</template>
