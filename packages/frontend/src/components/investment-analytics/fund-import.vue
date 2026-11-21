<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { Button } from '@/components/lib/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/lib/ui/dialog';
import {
  getCompositionCatalog,
  importFundHoldings,
  inspectCompositionFile,
  refreshFundComposition,
  setCompositionSchedule,
} from '@/api/investment-analytics';
import type { InvestmentFundSnapshot, InvestmentHolding } from '@bt/shared/types/investment-analytics';
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ funds: InvestmentHolding[]; securities?: InvestmentHolding[] }>();
const emit = defineEmits<{ saved: [] }>();
const client = useQueryClient();
const catalog = useQuery({
  queryKey: ['fund-composition-catalog'],
  queryFn: getCompositionCatalog,
  enabled: () => open.value,
  staleTime: 0,
});
const fundId = ref(''),
  adapter = ref('sec-nport'),
  asOf = ref(''),
  sourceUrl = ref(''),
  contact = ref('');
const file = ref<File | null>(null),
  preview = ref<InvestmentFundSnapshot[]>([]),
  error = ref(''),
  busy = ref(false),
  result = ref('');
const funds = computed(
  () =>
    catalog.data.value?.funds ??
    props.funds.map((f) => ({
      ...f,
      fundId: f.id,
      excludedFromAnalytics: false,
      identityConflict: false,
      seriesId: undefined,
    })),
);
const selected = computed(() => funds.value.find((f) => f.id === fundId.value));
const source = computed(() =>
  catalog.data.value?.sources.find(
    (s) => s.symbol === selected.value?.symbol || s.aliases?.includes(selected.value?.symbol ?? ''),
  ),
);
watch(fundId, () => {
  adapter.value =
    selected.value?.symbol === 'GLD'
      ? 'sec-gold-facts'
      : source.value?.seriesId
        ? 'sec-nport'
        : (source.value?.adapter ?? 'canonical-csv');
  preview.value = [];
  error.value = '';
});
watch([adapter, fundId], () => {
  sourceUrl.value =
    adapter.value === 'sec-gold-facts'
      ? 'https://data.sec.gov/api/xbrl/companyfacts/CIK0001222333.json'
      : adapter.value === 'sec-nport'
        ? ''
        : (source.value?.issuerUrl ?? '');
  preview.value = [];
});
watch([file, asOf, sourceUrl], () => {
  preview.value = [];
});
async function input(commit: boolean) {
  if (!file.value || !selected.value) throw new Error('Choose a fund and its original source file.');
  if (file.value.size > 12 * 1024 * 1024) throw new Error('Use an individual file smaller than 12 MB.');
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]!);
    reader.onerror = reject;
    reader.readAsDataURL(file.value!);
  });
  return {
    fundId: fundId.value,
    symbol: selected.value.symbol,
    adapter: adapter.value,
    fileName: file.value.name,
    base64,
    sourceUrl: sourceUrl.value || undefined,
    asOf: asOf.value || undefined,
    commit,
  };
}
async function inspect() {
  busy.value = true;
  error.value = '';
  preview.value = [];
  result.value = '';
  try {
    if (adapter.value === 'canonical-json') {
      if (!file.value || file.value.size > 2 * 1024 * 1024)
        throw new Error('Choose a JSON snapshot file smaller than 2 MB.');
      const parsed = JSON.parse(await file.value.text());
      const snapshots = Array.isArray(parsed) ? parsed : (parsed.snapshots ?? [parsed]);
      if (
        !snapshots.length ||
        snapshots.some((s: InvestmentFundSnapshot) => !s.fundId || !s.asOf || !s.provider || !s.holdings?.length)
      )
        throw new Error('JSON needs dated snapshots with stable fund and constituent identities.');
      preview.value = snapshots;
    } else preview.value = [(await inspectCompositionFile(await input(false))).snapshot];
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'The file could not be validated.';
  } finally {
    busy.value = false;
  }
}
async function saved() {
  await client.invalidateQueries({ queryKey: ['investment-analytics'] });
  await client.invalidateQueries({ queryKey: ['fund-composition-catalog'] });
  emit('saved');
}
async function save() {
  if (!preview.value.length) return;
  busy.value = true;
  error.value = '';
  try {
    if (adapter.value === 'canonical-json') await importFundHoldings(preview.value);
    else await inspectCompositionFile(await input(true));
    await saved();
    open.value = false;
    preview.value = [];
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'The snapshot could not be saved.';
  } finally {
    busy.value = false;
  }
}
async function refresh() {
  if (!selected.value || !contact.value) {
    error.value = 'Choose a fund and supply a contact email for the SEC identified User-Agent.';
    return;
  }
  busy.value = true;
  error.value = '';
  result.value = '';
  try {
    const response = await refreshFundComposition([fundId.value], contact.value);
    result.value = response.results.map((r) => `${r.symbol}: ${r.status}${r.error ? ' · ' + r.error : ''}`).join('\n');
    await saved();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'SEC refresh failed; existing composition is retained.';
  } finally {
    busy.value = false;
  }
}
async function schedule(enabled: boolean) {
  busy.value = true;
  error.value = '';
  try {
    await setCompositionSchedule(enabled, contact.value || undefined);
    result.value = enabled
      ? 'Weekly SEC refresh enabled. The first background run is queued; its results will appear in source health.'
      : 'Scheduled composition refresh disabled.';
    await saved();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Schedule update failed.';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Dialog v-model:open="open"
    ><DialogContent class="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
      ><DialogHeader
        ><DialogTitle>Import fund composition</DialogTitle
        ><DialogDescription
          >Import original issuer or SEC files with their report date, source and checksum.</DialogDescription
        ></DialogHeader
      >
      <div class="space-y-3">
        <label class="block text-xs"
          >Fund<select
            v-model="fundId"
            aria-label="Fund composition security"
            class="bg-background mt-1 h-9 w-full rounded-md border px-2"
          >
            <option value="">Choose held fund</option>
            <option v-for="fund in funds" :key="fund.id" :value="fund.id">
              {{ fund.symbol }} · {{ fund.name }}{{ fund.excludedFromAnalytics ? ' · hidden portfolio (excluded)' : ''
              }}{{ fund.identityConflict ? ' · identity review required' : '' }}
            </option>
          </select></label
        >
        <p v-if="selected?.identityConflict" role="alert" class="text-app-expense-color text-xs">
          {{
            'identityEvidence' in selected
              ? selected.identityEvidence
              : 'SPCX has conflicting native metadata. Verify its brokerage CUSIP/ISIN before attaching SPCK holdings.'
          }}
        </p>
        <div v-if="source" class="text-muted-foreground flex flex-wrap gap-3 text-xs">
          <a :href="source.issuerUrl" target="_blank" rel="noopener noreferrer" class="text-primary-text underline"
            >Open issuer download page</a
          ><a
            v-if="source.secUrl"
            :href="source.secUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary-text underline"
            >Open SEC filing list</a
          >
        </div>
        <label class="block text-xs"
          >File format<select
            v-model="adapter"
            aria-label="Fund composition file format"
            class="bg-background mt-1 h-9 w-full rounded-md border px-2"
          >
            <option v-if="source?.seriesId" value="sec-nport">SEC N-PORT XML / single-filing ZIP</option>
            <option v-if="selected?.symbol === 'GLD'" value="sec-gold-facts">SEC gold trust balance-sheet JSON</option>
            <option
              v-if="source?.adapter && !['canonical-csv', 'gld-xlsx'].includes(source.adapter)"
              :value="source.adapter"
            >
              Original issuer {{ source.adapter }}
            </option>
            <option value="canonical-csv">Manual canonical CSV</option>
            <option value="canonical-json">Legacy composition JSON</option>
          </select></label
        >
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block text-xs"
            >Effective date (only if absent from file)<input
              v-model="asOf"
              type="date"
              class="bg-background mt-1 h-9 w-full rounded-md border px-2" /></label
          ><label class="block text-xs"
            >Exact source URL<input
              v-model="sourceUrl"
              type="url"
              placeholder="https://issuer.example/holdings.csv"
              class="bg-background mt-1 h-9 w-full rounded-md border px-2"
          /></label>
        </div>
        <input
          type="file"
          accept=".csv,.xlsx,.xml,.zip,.json,.tsv"
          aria-label="Fund holdings file"
          class="block max-w-full text-xs"
          @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null"
        />
        <p class="text-muted-foreground text-xs">
          Use the original export with its metadata. CSV weights are percentages (5 = 5%). Partial files retain their
          residual; derivatives and cash stay separate from companies. Restricted issuer downloads remain manual.
        </p>
        <Button variant="outline" size="sm" :disabled="busy || selected?.identityConflict" @click="inspect">{{
          busy ? 'Validating…' : 'Preview holdings'
        }}</Button>
        <p v-if="error" role="alert" class="text-app-expense-color text-sm">{{ error }}</p>
        <div
          v-if="preview.length"
          class="bg-muted/40 space-y-2 rounded-md p-3 text-xs"
          data-testid="fund-import-preview"
        >
          <div v-for="snapshot in preview" :key="snapshot.fundId + snapshot.asOf">
            <p class="font-semibold">
              {{ snapshot.symbol }} · {{ snapshot.asOf }} ·
              {{ snapshot.provenance?.parsedRowCount ?? snapshot.holdings.length }} source rows ·
              {{ Number(snapshot.coverage).toFixed(4) }}% coverage
            </p>
            <p class="text-muted-foreground break-all">{{ snapshot.provenance?.sourceUrl ?? snapshot.provider }}</p>
            <p v-for="warning in snapshot.provenance?.warnings ?? []" :key="warning" class="mt-1">{{ warning }}</p>
          </div>
          <Button size="sm" :disabled="busy" @click="save">Save composition snapshots</Button>
        </div>
        <details v-if="source?.seriesId || selected?.symbol === 'GLD'" class="border-t pt-3 text-xs">
          <summary class="cursor-pointer">Fetch permitted SEC disclosure</summary>
          <p class="text-muted-foreground my-2">
            The SEC receives the contact email in an identified User-Agent. Requests are serialized and stop on access
            restrictions. This button runs one refresh; no schedule is enabled.
          </p>
          <label
            >SEC contact email<input
              v-model="contact"
              type="email"
              class="bg-background mt-1 h-9 w-full rounded-md border px-2" /></label
          ><Button
            size="sm"
            variant="outline"
            class="mt-2"
            :disabled="busy || selected?.identityConflict"
            @click="refresh"
            >Fetch latest SEC composition</Button
          >
          <p v-if="result" class="mt-2 whitespace-pre-line" role="status">{{ result }}</p>
        </details>
        <details class="border-t pt-3 text-xs">
          <summary class="cursor-pointer">Scheduled SEC refresh</summary>
          <p class="text-muted-foreground my-2">{{ catalog.data.value?.schedule }}</p>
          <p class="text-muted-foreground mb-2">
            Weekly checks use only permitted SEC sources and visible portfolios. More recent manual issuer imports
            remain preferred. Enabling queues an initial background run.
          </p>
          <label
            >SEC contact email<input
              v-model="contact"
              type="email"
              class="bg-background mt-1 h-9 w-full rounded-md border px-2"
          /></label>
          <div class="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" :disabled="busy" @click="schedule(true)"
              >Enable weekly SEC refresh</Button
            ><Button size="sm" variant="ghost" :disabled="busy" @click="schedule(false)">Disable schedule</Button>
          </div>
          <p v-if="result" class="mt-2 whitespace-pre-line" role="status">{{ result }}</p>
        </details>
      </div>
    </DialogContent></Dialog
  >
</template>
