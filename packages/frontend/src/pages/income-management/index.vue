<script setup lang="ts">
import { getIncomeDashboard, importIncome, parseIncomeFile, saveIncomeDocument } from '@/api/income-management';
import PageWrapper from '@/components/common/page-wrapper.vue';
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { Callout } from '@/components/lib/ui/callout';
import { Dialog, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/lib/ui/dialog';
import type { IncomeDashboard, IncomeEmployer, IncomePaycheck } from '@bt/shared/types/income-management';
import { computed, onMounted, ref } from 'vue';

const data = ref<IncomeDashboard | null>(null),
  busy = ref(false),
  error = ref(''),
  notice = ref('');
const editorOpen = ref(false),
  employerName = ref(''),
  employerPerson = ref(''),
  employerKind = ref<'employment' | 'side-income'>('employment');
const importEmployer = ref(''),
  importRecords = ref<IncomePaycheck[]>([]),
  importIssues = ref<string[]>([]),
  reviewed = ref(false),
  fileInput = ref<HTMLInputElement | null>(null);
const field = 'border-input bg-background h-10 w-full rounded-md border px-3 text-sm';
const employer = (id: string) => data.value?.document.employers.find((e) => e.id === id)?.name ?? 'Unknown employer';
const money = (value: number | null | undefined) =>
  value == null
    ? 'Unavailable'
    : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);
const blank = (): IncomePaycheck => ({
  id: crypto.randomUUID(),
  employerId: data.value?.document.employers[0]?.id ?? '',
  date: new Date().toISOString().slice(0, 10),
  periodStart: null,
  periodEnd: null,
  evidence: 'actual',
  gross: null,
  bonus: 0,
  net: 0,
  federal: 0,
  state: 0,
  local: 0,
  socialSecurity: 0,
  medicare: 0,
  employerContributions: 0,
  withholdingComplete: false,
  deductions: [],
  nativeTransactionId: null,
  source: 'manual',
  sourceKey: null,
  notes: '',
});
const draft = ref<IncomePaycheck>(blank());
const paychecks = computed(() =>
  [...(data.value?.document.paychecks ?? [])].sort((a, b) => b.date.localeCompare(a.date)),
);
const taxKeys = ['federal', 'state', 'local', 'socialSecurity', 'medicare'] as const;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
async function load() {
  try {
    data.value = await getIncomeDashboard();
    importEmployer.value ||= data.value.document.employers[0]?.id ?? '';
  } catch {
    error.value = 'Income records could not be loaded. Saved financial data was not changed.';
  }
}
async function persist() {
  if (!data.value) return;
  const doc = clone(data.value.document);
  for (const e of doc.employers) {
    e.startDate ||= null;
    e.endDate ||= null;
  }
  for (const p of doc.paychecks) {
    p.periodStart ||= null;
    p.periodEnd ||= null;
  }
  data.value.document = await saveIncomeDocument(doc);
  await load();
}
async function addEmployer() {
  if (!data.value || !employerName.value.trim()) return;
  busy.value = true;
  error.value = '';
  try {
    const entry: IncomeEmployer = {
      id: crypto.randomUUID(),
      name: employerName.value.trim(),
      person: employerPerson.value.trim(),
      kind: employerKind.value,
      startDate: null,
      endDate: null,
    };
    data.value.document.employers.push(entry);
    await persist();
    employerName.value = '';
    employerPerson.value = '';
    notice.value = 'Employer added. No salary or historical paychecks were invented.';
  } catch {
    error.value = 'Employer could not be saved. Reload before trying again.';
    await load();
  } finally {
    busy.value = false;
  }
}
function edit(paycheck?: IncomePaycheck) {
  draft.value = paycheck ? clone(paycheck) : blank();
  reviewed.value = paycheck?.source !== 'pdf';
  editorOpen.value = true;
}
async function savePaycheck() {
  if (!data.value) return;
  busy.value = true;
  error.value = '';
  try {
    const doc = data.value.document;
    doc.paychecks = [...doc.paychecks.filter((p) => p.id !== draft.value.id), clone(draft.value)];
    await persist();
    editorOpen.value = false;
    notice.value =
      'Paycheck saved. Linked bank deposits are counted once; possible unlinked duplicates are held for review.';
  } catch {
    error.value =
      'Paycheck was not saved. Verify dates, amounts and bank matching, or reload if data changed elsewhere.';
    await load();
  } finally {
    busy.value = false;
  }
}
async function link(paycheckId: string, bankId: string) {
  if (!data.value) return;
  busy.value = true;
  try {
    const row = data.value.document.paychecks.find((p) => p.id === paycheckId);
    if (row) row.nativeTransactionId = bankId;
    await persist();
    notice.value = 'Paycheck linked to the existing bank deposit. No new bank transaction was created.';
  } catch {
    error.value = 'Unable to link this deposit. Amount, ownership and posting date must match.';
    await load();
  } finally {
    busy.value = false;
  }
}
async function parseFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file || !importEmployer.value) return;
  busy.value = true;
  error.value = '';
  importRecords.value = [];
  importIssues.value = [];
  try {
    const type = file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'csv';
    if (file.size > 5_500_000) throw Error('size');
    let content: string;
    if (type === 'csv') content = await file.text();
    else
      content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    const parsed = await parseIncomeFile(importEmployer.value, type, content);
    importIssues.value = parsed.issues;
    if (parsed.type === 'pdf' && parsed.record) {
      draft.value = parsed.record;
      reviewed.value = false;
      editorOpen.value = true;
    } else {
      importRecords.value = parsed.records ?? [];
      if (importRecords.value.length) {
        const preview = await importIncome(importRecords.value, data.value!.document.revision, true);
        notice.value = `Preview: ${preview.inserted} new paychecks, ${preview.duplicates} duplicates skipped, ${preview.conflicts} conflicting records held for review. Confirm the current-period fields before importing.`;
      }
    }
  } catch {
    error.value =
      'Could not parse this file locally. Use the CSV template or enter the paycheck manually. Scanned PDFs require a text export.';
  } finally {
    busy.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}
async function commitImport() {
  if (!data.value) return;
  busy.value = true;
  try {
    const imported = await importIncome(importRecords.value, data.value.document.revision, false);
    notice.value = `Imported ${imported.inserted} paychecks; skipped ${imported.duplicates} duplicates and ${imported.conflicts} conflicting records.`;
    importRecords.value = [];
    await load();
  } catch {
    error.value = 'Import not committed. Reload and preview again to resolve changes or invalid employer/date data.';
  } finally {
    busy.value = false;
  }
}
function downloadTemplate() {
  const text =
    'date,gross,bonus,net,federal,state,local,socialSecurity,medicare,employerContributions,evidence,externalId,notes\n';
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'paycheck-import-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}
onMounted(load);
</script>
<template>
  <PageWrapper
    ><div class="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold">Income</h1>
          <p class="text-muted-foreground mt-1 text-sm">
            Employers, household income, actual paychecks and historical imports.
          </p>
        </div>
        <div class="flex gap-2">
          <Button as-child variant="outline"
            ><router-link to="/finances/taxes">Salary and tax planning</router-link></Button
          ><Button :disabled="!data?.document.employers.length" @click="edit()">Add paycheck</Button>
        </div>
      </div>
      <Callout v-if="error" variant="destructive">{{ error }}</Callout
      ><Callout v-if="notice">{{ notice }}</Callout>
      <template v-if="data">
        <div class="grid gap-4 sm:grid-cols-3">
          <Card class="p-5"
            ><p class="text-muted-foreground text-sm">Actual recorded net income</p>
            <p class="mt-2 text-2xl font-semibold">{{ money(data.currentBehavior.actualIncome) }}</p>
            <p class="text-muted-foreground mt-2 text-xs">
              {{ data.currentBehavior.from }} through {{ data.currentBehavior.through }}
            </p></Card
          ><Card class="p-5"
            ><p class="text-muted-foreground text-sm">Posted bank income</p>
            <p class="mt-2 text-2xl font-semibold">{{ money(data.currentBehavior.bankNetIncome) }}</p>
            <p class="text-muted-foreground mt-2 text-xs">Transfers and excluded accounts omitted</p></Card
          ><Card class="p-5"
            ><p class="text-muted-foreground text-sm">Verified gross income</p>
            <p class="mt-2 text-2xl font-semibold">{{ money(data.currentBehavior.grossKnown) }}</p>
            <p class="text-muted-foreground mt-2 text-xs">
              Gross is unavailable where only net bank deposits exist
            </p></Card
          >
        </div>
        <p class="text-muted-foreground text-sm">{{ data.currentBehavior.basis }}</p>
        <Callout v-if="data.currentBehavior.heldForReconciliation"
          >{{ data.currentBehavior.heldForReconciliation }} unlinked paycheck records may match bank deposits. Their net
          amounts are held out of the combined total until reconciled.</Callout
        >
        <Card class="space-y-4 p-5"
          ><h2 class="font-semibold">Employers and household members</h2>
          <div
            v-for="item in data.document.employers"
            :key="item.id"
            class="border-border grid gap-3 border-t pt-3 sm:grid-cols-4"
          >
            <label class="text-xs">Employer<input v-model="item.name" :class="field" /></label
            ><label class="text-xs">Person<input v-model="item.person" :class="field" /></label
            ><label class="text-xs"
              >Start date (if known)<input v-model="item.startDate" type="date" :class="field" /></label
            ><label class="text-xs"
              >End date (optional)<input v-model="item.endDate" type="date" :class="field"
            /></label>
          </div>
          <Button v-if="data.document.employers.length" variant="outline" :disabled="busy" @click="persist"
            >Save employer changes</Button
          >
          <div class="grid items-end gap-3 border-t pt-4 sm:grid-cols-4">
            <label class="text-xs">Employer / side-income source<input v-model="employerName" :class="field" /></label
            ><label class="text-xs">Household member<input v-model="employerPerson" :class="field" /></label
            ><label class="text-xs"
              >Type<select v-model="employerKind" :class="field">
                <option value="employment">Employment</option>
                <option value="side-income">Side income</option>
              </select></label
            ><Button :disabled="busy || !employerName.trim()" @click="addEmployer">Add employer</Button>
          </div></Card
        >
        <Card class="space-y-4 p-5"
          ><h2 class="font-semibold">Import paychecks</h2>
          <p class="text-muted-foreground text-sm">
            CSV and text-based PDF paystubs are parsed locally. Preview and review before saving; no cloud payroll
            service is required.
          </p>
          <div class="flex flex-wrap items-end gap-3">
            <label class="min-w-48 flex-1 space-y-1 text-sm"
              >Employer<select v-model="importEmployer" :class="field">
                <option value="" disabled>Select employer</option>
                <option v-for="item in data.document.employers" :key="item.id" :value="item.id">
                  {{ item.person }} {{ item.name }}
                </option>
              </select></label
            ><Button variant="outline" @click="downloadTemplate">CSV template</Button
            ><Button variant="outline" :disabled="busy || !importEmployer" @click="fileInput?.click()"
              >Choose CSV / PDF</Button
            ><input ref="fileInput" type="file" accept=".csv,.pdf" class="hidden" @change="parseFile" />
          </div>
          <ul v-if="importIssues.length" class="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
            <li v-for="issue in importIssues" :key="issue">{{ issue }}</li>
          </ul>
          <div v-if="importRecords.length" class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-border border-b text-left">
                  <th class="p-2">Date</th>
                  <th class="p-2">Evidence</th>
                  <th class="p-2 text-right">Gross</th>
                  <th class="p-2 text-right">Bonus</th>
                  <th class="p-2 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in importRecords.slice(0, 100)" :key="entry.id">
                  <td class="p-2">{{ entry.date }}</td>
                  <td class="p-2">{{ entry.evidence }}</td>
                  <td class="p-2 text-right">{{ money(entry.gross) }}</td>
                  <td class="p-2 text-right">{{ money(entry.bonus) }}</td>
                  <td class="p-2 text-right">{{ money(entry.net) }}</td>
                </tr>
              </tbody>
            </table>
            <Button class="mt-4" :disabled="busy" @click="commitImport">Import reviewed paychecks</Button>
          </div></Card
        >
        <Card v-if="data.reconciliation.some((r) => r.candidates.length)" class="space-y-4 p-5"
          ><h2 class="font-semibold">Reconcile paychecks with existing deposits</h2>
          <div
            v-for="match in data.reconciliation.filter((r) => r.candidates.length)"
            :key="match.paycheckId"
            class="border-border space-y-2 border-t pt-3"
          >
            <p class="text-sm">
              {{ employer(data.document.paychecks.find((p) => p.id === match.paycheckId)?.employerId ?? '') }} â€”
              {{ data.document.paychecks.find((p) => p.id === match.paycheckId)?.date }}
            </p>
            <Button
              v-for="bank in match.candidates"
              :key="bank.id"
              variant="outline"
              class="h-auto text-left whitespace-normal"
              :disabled="busy"
              @click="link(match.paycheckId, bank.id)"
              >Link {{ bank.date }} Â· {{ bank.description }} Â· {{ money(bank.amount) }}</Button
            >
          </div></Card
        >
        <Card class="overflow-hidden"
          ><div class="p-5"><h2 class="font-semibold">Paycheck history</h2></div>
          <p v-if="!paychecks.length" class="text-muted-foreground px-5 pb-5 text-sm">
            No manual paychecks yet. Bank deposits remain intact and appear in recorded income.
          </p>
          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-160 text-sm">
              <thead class="bg-muted text-left">
                <tr>
                  <th class="p-3">Date / Employer</th>
                  <th class="p-3">Evidence</th>
                  <th class="p-3 text-right">Gross</th>
                  <th class="p-3 text-right">Net</th>
                  <th class="p-3">Bank match</th>
                  <th class="p-3"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in paychecks" :key="entry.id" class="border-border border-t">
                  <td class="p-3">
                    {{ entry.date }}
                    <p class="text-muted-foreground text-xs">{{ employer(entry.employerId) }}</p>
                  </td>
                  <td class="p-3">{{ entry.evidence }}</td>
                  <td class="p-3 text-right">{{ money(entry.gross) }}</td>
                  <td class="p-3 text-right">{{ money(entry.net) }}</td>
                  <td class="p-3">{{ entry.nativeTransactionId ? 'Linked' : 'Unlinked' }}</td>
                  <td class="p-3"><Button variant="ghost" @click="edit(entry)">Edit</Button></td>
                </tr>
              </tbody>
            </table>
          </div></Card
        >
      </template>
      <Dialog v-model:open="editorOpen"
        ><DialogScrollContent class="max-w-3xl"
          ><DialogHeader
            ><DialogTitle>{{ draft.source === 'pdf' ? 'Review local paystub extraction' : 'Paycheck' }}</DialogTitle
            ><DialogDescription
              >Use actual current-period amounts. Gross includes the bonus portion; employer contributions are separate
              from net pay.</DialogDescription
            ></DialogHeader
          >
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="space-y-1 text-sm"
              >Employer<select v-model="draft.employerId" :class="field">
                <option v-for="item in data?.document.employers" :key="item.id" :value="item.id">
                  {{ item.person }} {{ item.name }}
                </option>
              </select></label
            ><label class="space-y-1 text-sm">Pay date<input v-model="draft.date" type="date" :class="field" /></label
            ><label class="space-y-1 text-sm"
              >Evidence<select v-model="draft.evidence" :class="field">
                <option value="actual">Actual</option>
                <option value="estimated">Estimated</option>
                <option value="projected">Projected</option>
              </select></label
            ><label class="space-y-1 text-sm"
              >Gross pay (leave unknown blank)<input
                :value="draft.gross"
                type="number"
                min="0"
                step="0.01"
                :class="field"
                @input="
                  draft.gross =
                    ($event.target as HTMLInputElement).value === ''
                      ? null
                      : Number(($event.target as HTMLInputElement).value)
                " /></label
            ><label class="space-y-1 text-sm"
              >Bonus (included in gross)<input
                v-model.number="draft.bonus"
                type="number"
                min="0"
                step="0.01"
                :class="field" /></label
            ><label class="space-y-1 text-sm"
              >Net pay<input v-model.number="draft.net" type="number" min="0" step="0.01" :class="field" /></label
            ><label v-for="key in taxKeys" :key="key" class="space-y-1 text-sm"
              >{{ key.replace(/([A-Z])/g, ' $1') }} withholding<input
                v-model.number="draft[key]"
                type="number"
                min="0"
                step="0.01"
                :class="field" /></label
            ><label class="space-y-1 text-sm"
              >Employer contributions<input
                v-model.number="draft.employerContributions"
                type="number"
                min="0"
                step="0.01"
                :class="field" /></label
            ><label class="space-y-1 text-sm"
              >Pay period start<input v-model="draft.periodStart" type="date" :class="field" /></label
            ><label class="space-y-1 text-sm"
              >Pay period end<input v-model="draft.periodEnd" type="date" :class="field"
            /></label>
          </div>
          <label class="mt-2 flex items-center gap-2 text-sm"
            ><input v-model="draft.withholdingComplete" type="checkbox" /> I have verified the current-period
            withholding fields (including any actual zeros)</label
          ><label class="mt-3 block space-y-1 text-sm"
            >Notes<textarea v-model="draft.notes" :class="field + ' h-20 py-2'" /></label
          ><label v-if="draft.source === 'pdf'" class="mt-3 flex items-center gap-2 text-sm"
            ><input v-model="reviewed" type="checkbox" /> I compared the extracted current-period amounts with the
            paystub</label
          >
          <p v-if="draft.nativeTransactionId" class="text-muted-foreground mt-3 text-xs">
            This paycheck is linked to an existing deposit and its net amount must continue to match.
          </p>
          <Button
            class="mt-4"
            :disabled="busy || !draft.employerId || !draft.date || (draft.source === 'pdf' && !reviewed)"
            @click="savePaycheck"
            >Save paycheck</Button
          ></DialogScrollContent
        ></Dialog
      >
    </div></PageWrapper
  >
</template>
