<script setup lang="ts">
import type { FundCompositionStatus } from '@bt/shared/types/investment-analytics';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
defineProps<{ rows: FundCompositionStatus[]; compact?: boolean }>();
const percent = (value: string) => `${Number(value).toFixed(4)}%`;
const age = (date: string | null) => (date ? Math.floor((Date.now() - Date.parse(date)) / 86400000) : null);
</script>
<template>
  <details :open="!compact" class="min-w-0 border-t pt-3" data-testid="fund-composition-health">
    <summary class="text-primary-text cursor-pointer text-xs">
      Fund composition sources · {{ rows.filter((row) => row.asOf).length }} / {{ rows.length }} populated
    </summary>
    <p class="text-muted-foreground mt-2 text-xs">
      Dated disclosures, not live composition. Coverage includes identified non-company assets. Signed residual balances
      remain unallocated; source weights are never scaled to 100%.
    </p>
    <ScrollArea class="mt-2 h-96 min-w-0 rounded-md border" with-horizontal-scrollbar>
      <table class="w-full min-w-[45rem] text-left text-xs">
        <thead class="bg-muted/80 sticky top-0">
          <tr>
            <th class="p-2">Fund / source</th>
            <th class="p-2">Effective date</th>
            <th class="p-2">Rows</th>
            <th class="p-2">Coverage</th>
            <th class="p-2">Net residual</th>
            <th class="p-2">Refresh evidence</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.fundId" class="border-t align-top">
            <td class="max-w-64 p-2">
              <strong>{{ row.symbol }}</strong
              ><a
                v-if="row.sourceUrl"
                :href="row.sourceUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary-text mt-1 block break-all underline"
                >{{ row.sourceId }}</a
              >
              <details v-if="row.warnings.length || row.blocker" class="mt-1">
                <summary class="cursor-pointer">{{ row.status }} · source details</summary>
                <p v-if="row.blocker" class="mt-1">{{ row.blocker }}</p>
                <p v-if="row.netWeight && row.grossWeight" class="mt-1">
                  Reported net weight {{ percent(row.netWeight) }} · gross weight {{ percent(row.grossWeight) }}.
                </p>
                <p v-for="warning in row.warnings" :key="warning" class="text-muted-foreground mt-1">{{ warning }}</p>
                <p class="text-muted-foreground mt-1 break-all">{{ row.sourceUrl }}</p>
              </details>
            </td>
            <td class="p-2 whitespace-nowrap">
              {{ row.asOf ?? 'Missing'
              }}<span v-if="(age(row.asOf) ?? 0) > 90" class="text-muted-foreground block"
                >{{ age(row.asOf) }} days old</span
              ><span v-if="row.retrievedAt" class="text-muted-foreground block" :title="row.retrievedAt"
                >Retrieved {{ row.retrievedAt.slice(0, 10) }}</span
              >
            </td>
            <td class="p-2 tabular-nums">{{ row.rows.toLocaleString() }}</td>
            <td class="p-2 tabular-nums">{{ percent(row.coverage) }}</td>
            <td class="p-2 tabular-nums">{{ percent(row.residual) }}</td>
            <td class="max-w-48 p-2">
              <p>{{ row.autoRefreshPermitted ? 'SEC automated access permitted' : 'Manual import' }}</p>
              <p class="text-muted-foreground">
                {{
                  row.autoRefreshOperational
                    ? 'Background worker verified'
                    : row.scheduledRefreshEnabled
                      ? 'Background refresh pending'
                      : 'Schedule disabled'
                }}
              </p>
              <p v-if="row.lastRefreshRun" class="text-muted-foreground">
                Last run {{ row.lastRefreshRun.slice(0, 16).replace('T', ' ') }} UTC
              </p>
              <p v-if="row.refreshAsOf" class="text-muted-foreground">SEC report {{ row.refreshAsOf }}</p>
              <p v-if="row.nextRefreshDue" class="text-muted-foreground">
                Next due {{ row.nextRefreshDue.slice(0, 10) }}
              </p>
            </td>
          </tr>
        </tbody>
      </table>
    </ScrollArea>
  </details>
</template>
