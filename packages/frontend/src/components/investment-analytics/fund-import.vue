<script setup lang="ts">
import { computed, ref } from 'vue';
import Papa from 'papaparse';
import { Button } from '@/components/lib/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/lib/ui/dialog';
import { importFundHoldings } from '@/api/investment-analytics';
import type { InvestmentFundSnapshot, InvestmentHolding } from '@bt/shared/types/investment-analytics';
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ funds: InvestmentHolding[]; securities?: InvestmentHolding[] }>();
const emit = defineEmits<{ saved: [] }>();
const fundId = ref(''),
  asOf = ref(''),
  provider = ref(''),
  file = ref<File | null>(null),
  preview = ref<InvestmentFundSnapshot[]>([]),
  error = ref(''),
  saving = ref(false);
const total = computed(() => preview.value.reduce((n, snapshot) => n + snapshot.holdings.length, 0));
async function inspect() {
  error.value = '';
  preview.value = [];
  try {
    if (!file.value) throw new Error('Choose a CSV or JSON holdings file.');
    if (file.value.size > 2 * 1024 * 1024) throw new Error('Use a file smaller than 2 MB.');
    const raw = await file.value.text();
    let snapshots: InvestmentFundSnapshot[];
    if (file.value.name.toLowerCase().endsWith('.json')) {
      const parsed = JSON.parse(raw);
      snapshots = Array.isArray(parsed) ? parsed : (parsed.snapshots ?? [parsed]);
    } else {
      if (!fundId.value || !asOf.value || !provider.value.trim())
        throw new Error('Choose the fund, effective date and source before previewing CSV.');
      const parsed = Papa.parse<Record<string, string>>(raw, { header: true, skipEmptyLines: true });
      if (parsed.errors.length) throw new Error('The CSV could not be parsed: ' + parsed.errors[0]!.message);
      const fund = props.funds.find((row) => row.id === fundId.value)!;
      snapshots = [
        {
          fundId: fundId.value,
          symbol: fund.symbol,
          asOf: asOf.value,
          provider: provider.value.trim(),
          retrievedAt: new Date().toISOString(),
          coverage: '0',
          holdings: parsed.data.map((row) => ({
            id: row.id || row.isin || row.cusip || '',
            symbol: row.symbol ?? '',
            name: row.name ?? '',
            weight: row.weight ?? '',
            sector: row.sector || undefined,
            industry: row.industry || undefined,
            country: row.country || undefined,
            region: row.region || undefined,
            market: row.market || undefined,
            assetClass: row.assetClass || undefined,
            marketCap: row.marketCap || undefined,
            style: row.style || undefined,
            isFund: row.isFund === 'true',
            isin: row.isin || undefined,
            cusip: row.cusip || undefined,
            currencyCode: row.currencyCode || undefined,
            exchange: row.exchange || undefined,
          })),
        },
      ];
    }
    if (!snapshots.length) throw new Error('The file contains no snapshots.');
    for (const snapshot of snapshots) {
      if (
        !snapshot.fundId ||
        !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.asOf) ||
        !Number.isFinite(Date.parse(snapshot.asOf)) ||
        new Date(snapshot.asOf).toISOString().slice(0, 10) !== snapshot.asOf ||
        !snapshot.provider?.trim() ||
        !Array.isArray(snapshot.holdings)
      )
        throw new Error('Each snapshot needs fundId, a valid YYYY-MM-DD asOf, provider and holdings.');
      if (snapshot.asOf > new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }))
        throw new Error('An effective date cannot be in the future.');
      const ids = new Set<string>();
      let weight = 0;
      for (const row of snapshot.holdings) {
        row.id = row.id || row.isin || row.cusip || '';
        if (
          !row.id ||
          ids.has(row.id) ||
          !row.symbol ||
          !row.name ||
          String(row.weight ?? '').trim() === '' ||
          !Number.isFinite(Number(row.weight)) ||
          Number(row.weight) < 0 ||
          Number(row.weight) > 100
        )
          throw new Error(
            'Every constituent needs a unique stable id, symbol, name and decimal weight between 0 and 100.',
          );
        ids.add(row.id);
        weight += Number(row.weight);
      }
      if (weight > 100.000001) throw new Error('Constituent weights exceed 100%.');
      snapshot.coverage = String(weight);
      snapshot.retrievedAt = new Date().toISOString();
    }
    preview.value = snapshots;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'The file could not be read.';
  }
}
async function save() {
  if (!preview.value.length || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    await importFundHoldings(preview.value);
    emit('saved');
    open.value = false;
    preview.value = [];
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'The holdings snapshot could not be saved.';
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <Dialog v-model:open="open"
    ><DialogContent class="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
      ><DialogHeader
        ><DialogTitle>Import fund composition</DialogTitle
        ><DialogDescription
          >Save dated underlying weights with source provenance. This adds analysis data without changing positions or
          transactions.</DialogDescription
        ></DialogHeader
      >
      <div class="space-y-3">
        <p class="text-muted-foreground text-xs">
          CSV columns: id (or isin / cusip), symbol, name, weight; optional sector, industry, country, region, market,
          assetClass, marketCap, style, isFund. Use percentage weights (5 = 5%). Stable ids must identify the same
          company across all funds. JSON accepts a snapshot, array, or { snapshots: [...] } using the same fields plus
          fundId, asOf and provider.
        </p>
        <details class="text-xs">
          <summary class="text-primary-text cursor-pointer">Known security identifiers</summary>
          <p class="text-muted-foreground mt-2">
            Use native identifiers or validated issuer ISIN / CUSIP values to combine imported constituents with
            existing direct positions. Reuse the same identifier across fund files. Ambiguous issuer matches remain
            separate; ticker names alone never merge companies.
          </p>
          <div class="mt-2 max-h-40 overflow-auto">
            <p v-for="security in securities ?? funds" :key="security.id" class="border-b py-1">
              <strong>{{ security.symbol }}</strong> ? {{ security.name
              }}<code class="block break-all">{{ security.id }}</code>
            </p>
          </div>
        </details>
        <label class="block text-xs"
          >Fund<select
            v-model="fundId"
            aria-label="Fund composition security"
            class="bg-background mt-1 h-9 w-full rounded-md border px-2"
          >
            <option value="">Choose held fund</option>
            <option v-for="fund in funds" :key="fund.id" :value="fund.id">{{ fund.symbol }} · {{ fund.name }}</option>
          </select></label
        >
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-xs"
            >Effective date<input
              v-model="asOf"
              type="date"
              class="bg-background mt-1 h-9 w-full rounded-md border px-2" /></label
          ><label class="block text-xs"
            >Source / provider<input
              v-model="provider"
              placeholder="Issuer holdings download"
              class="bg-background mt-1 h-9 w-full rounded-md border px-2"
          /></label>
        </div>
        <input
          type="file"
          accept=".csv,.json,text/csv,application/json"
          aria-label="Fund holdings file"
          class="block max-w-full text-xs"
          @change="
            file = ($event.target as HTMLInputElement).files?.[0] ?? null;
            preview = [];
          "
        /><Button variant="outline" size="sm" @click="inspect">Preview holdings</Button>
        <p v-if="error" role="alert" class="text-app-expense-color text-sm">{{ error }}</p>
        <div v-if="preview.length" class="bg-muted/40 rounded-md p-3 text-xs" data-testid="fund-import-preview">
          <p class="font-semibold">{{ preview.length }} snapshots · {{ total }} constituents</p>
          <p v-for="snapshot in preview" :key="snapshot.fundId + snapshot.asOf" class="mt-2">
            {{ snapshot.symbol }} · {{ snapshot.asOf }} · {{ snapshot.provider }} · coverage
            {{ Number(snapshot.coverage).toFixed(2) }}%
          </p>
          <p class="text-muted-foreground mt-2">
            Unreported weights remain Unknown. The source date and original weights are preserved.
          </p>
          <Button size="sm" class="mt-3" :disabled="saving" @click="save">{{
            saving ? 'Saving…' : 'Save composition snapshots'
          }}</Button>
        </div>
      </div></DialogContent
    ></Dialog
  >
</template>
