<script setup lang="ts">
import {
  importPayroll,
  savePayrollManagement,
  linkPayrollDeposits,
  parsePayrollPdf,
  importReviewedPayroll,
  reconcilePayrollRetirement,
  type PayrollPrincipalPreview,
} from '@/api/payroll';
import { getPersonalFinanceDashboard } from '@/api/personal-finance';
import type { IncomePaycheck } from '@bt/shared/types/income-management';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Dialog, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/lib/ui/dialog';
import type {
  PayrollDashboard,
  PayrollImportResult,
  PayrollManagementInput,
  PayrollSalaryEvent,
  PayrollStatement,
} from '@bt/shared/types/payroll';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import LegacyPaychecks from '../index.vue';
import { money } from './format';
import { PAYROLL_QUERY_KEY } from './use-payroll';
import { payrollToday } from './date-range';
export type PayrollManagementSection =
  | 'sync'
  | 'import'
  | 'paychecks'
  | 'employment'
  | 'salary'
  | 'settings'
  | 'history'
  | 'retirement'
  | 'legacy';
const section = defineModel<PayrollManagementSection | null>({ required: true });
const props = defineProps<{ data: PayrollDashboard }>();
const emit = defineEmits<{ saved: [] }>();
const open = computed({
  get: () => section.value !== null,
  set: (value: boolean) => {
    if (!value) section.value = null;
  },
});
const titles: Record<PayrollManagementSection, string> = {
  sync: 'Update ADP payroll',
  import: 'Import payroll files',
  paychecks: 'Paychecks',
  employment: 'Employment history',
  salary: 'Salary history',
  settings: 'Payroll settings',
  history: 'Payroll sync and import history',
  retirement: 'Reconcile retirement contributions',
  legacy: 'Manual and PDF paycheck records',
};
const draft = ref<PayrollManagementInput | null>(null),
  busy = ref(false),
  error = ref(''),
  notice = ref(''),
  employmentId = ref(''),
  content = ref(''),
  fileName = ref(''),
  preview = ref<PayrollImportResult | null>(null),
  selectedStatement = ref<PayrollStatement | null>(null),
  depositSelections = ref<string[]>([]);
const salaryEdit = ref<PayrollSalaryEvent | null>(null);
const pdfRecord = ref<IncomePaycheck | null>(null),
  pdfHash = ref<string | null>(null),
  pdfIssues = ref<string[]>([]),
  pdfReviewed = ref(false);
const taxFields = [
  { key: 'federal', name: 'Federal withholding' },
  { key: 'state', name: 'State withholding' },
  { key: 'local', name: 'Local withholding' },
  { key: 'socialSecurity', name: 'Social Security' },
  { key: 'medicare', name: 'Medicare' },
] as const;
const client = useQueryClient();
const retirementAccountId = ref(''),
  retirementPreview = ref<PayrollPrincipalPreview | null>(null);
const finance = useQuery({
  queryKey: ['payroll', 'retirement-accounts'],
  queryFn: () => getPersonalFinanceDashboard({ granularity: 'monthly', mode: 'personal' }),
  enabled: computed(() => section.value === 'retirement'),
});
const retirementAccounts = computed(
  () =>
    finance.data.value?.accounts.filter(
      (a) => a.categoryId === 'retirement' && a.balanceKind === 'asset' && a.currencyCode === 'USD',
    ) ?? [],
);
watch([employmentId, retirementAccountId], () => {
  retirementPreview.value = null;
});
const field = 'border-input bg-background h-10 w-full rounded-md border px-3 text-sm';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function refreshDraft() {
  draft.value = {
    revision: props.data.revision,
    employments: clone(props.data.employments),
    manualSalaryEvents: clone(props.data.manualSalaryEvents),
    settings: clone(props.data.status.settings),
  };
  employmentId.value ||=
    props.data.employments.find((e) => e.status === 'current')?.id ?? props.data.employments[0]?.id ?? '';
}
watch(
  section,
  () => {
    refreshDraft();
    error.value = '';
    notice.value = '';
    preview.value = null;
    selectedStatement.value = null;
    salaryEdit.value = null;
    pdfRecord.value = null;
    pdfHash.value = null;
    pdfIssues.value = [];
    pdfReviewed.value = false;
    retirementPreview.value = null;
  },
  { immediate: true },
);
const employerName = (id: string) =>
  props.data.employments.find((e) => e.id === id)?.employerName ?? 'Unknown employer';
async function saved() {
  await client.invalidateQueries({ queryKey: [PAYROLL_QUERY_KEY] });
  emit('saved');
}
async function save() {
  if (!draft.value) return;
  busy.value = true;
  error.value = '';
  try {
    for (const employment of draft.value.employments) {
      for (const key of ['startDate', 'endDate', 'positionStartDate', 'positionEndDate'] as const)
        employment[key] ||= null;
      for (const key of ['annualHours', 'manualAnnualSalary'] as const)
        if (typeof employment[key] !== 'number') employment[key] = null;
    }
    await savePayrollManagement(draft.value);
    await saved();
    section.value = null;
  } catch {
    error.value = 'Changes could not be saved. Reload the records before trying again.';
  } finally {
    busy.value = false;
  }
}
function addEmployment() {
  draft.value?.employments.push({
    id: crypto.randomUUID(),
    employerName: '',
    jobTitle: '',
    startDate: null,
    endDate: null,
    positionStartDate: null,
    positionEndDate: null,
    status: 'previous',
    source: 'manual',
    payFrequency: 'biweekly',
    compensationType: 'salary',
    annualHours: null,
    manualAnnualSalary: null,
    notes: '',
  });
}
function editSalary(event?: PayrollSalaryEvent) {
  const employment = props.data.employments.find((e) => e.id === (event?.employmentId ?? employmentId.value));
  salaryEdit.value = event
    ? { ...event, id: event.source === 'manual' ? event.id : crypto.randomUUID(), source: 'manual', confirmed: true }
    : {
        id: crypto.randomUUID(),
        employmentId: employment?.id ?? '',
        date: '',
        effectiveDate: null,
        firstObservedDate: '',
        periodStart: null,
        employerName: employment?.employerName ?? '',
        jobTitle: employment?.jobTitle ?? '',
        salary: 0,
        previousSalary: null,
        change: null,
        changePercent: null,
        regularRate: null,
        source: 'manual',
        kind: 'employment',
        notes: '',
        confirmed: true,
      };
}
function keepSalary() {
  const event = salaryEdit.value;
  if (!draft.value || !event || !event.employmentId || !event.date || event.salary < 0) return;
  event.firstObservedDate ||= event.date;
  event.effectiveDate ||= null;
  const i = draft.value.manualSalaryEvents.findIndex(
    (e) =>
      e.id === event.id || (e.employmentId === event.employmentId && e.firstObservedDate === event.firstObservedDate),
  );
  if (i >= 0) draft.value.manualSalaryEvents[i] = { ...event };
  else draft.value.manualSalaryEvents.push({ ...event });
  salaryEdit.value = null;
}
function newManual() {
  preview.value = null;
  content.value = '';
  pdfHash.value = null;
  pdfIssues.value = [];
  pdfReviewed.value = false;
  fileName.value = 'manual paycheck';
  pdfRecord.value = {
    id: crypto.randomUUID(),
    employerId: employmentId.value,
    date: payrollToday(),
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
  };
}
async function readFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  preview.value = null;
  error.value = '';
  content.value = '';
  pdfRecord.value = null;
  pdfHash.value = null;
  pdfReviewed.value = false;
  pdfIssues.value = [];
  if (file.size > 6_000_000) {
    error.value = 'Choose a payroll file smaller than 6 MB.';
    return;
  }
  fileName.value = file.name;
  if (file.name.toLowerCase().endsWith('.json')) {
    content.value = await file.text();
    return;
  }
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    error.value = 'Choose an ADP JSON export or a PDF paystub.';
    return;
  }
  if (!employmentId.value) {
    error.value = 'Choose employment before uploading a PDF.';
    return;
  }
  busy.value = true;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const parsed = await parsePayrollPdf({ employmentId: employmentId.value, content: btoa(binary) });
    pdfRecord.value = parsed.record;
    pdfHash.value = parsed.documentHash;
    pdfIssues.value = parsed.issues;
    if (!parsed.record)
      error.value = 'The PDF could not be read reliably. Enter a reviewed manual paycheck or use detailed JSON.';
  } catch {
    error.value = 'The PDF could not be extracted. Use detailed payroll JSON or enter a reviewed manual paycheck.';
  } finally {
    busy.value = false;
  }
}
async function runImport(previewOnly: boolean) {
  if (!employmentId.value || (!content.value && !pdfRecord.value) || (pdfRecord.value && !pdfReviewed.value)) return;
  busy.value = true;
  error.value = '';
  try {
    if (pdfRecord.value) {
      pdfRecord.value.periodStart ||= null;
      pdfRecord.value.periodEnd ||= null;
    }
    const result = pdfRecord.value
      ? await importReviewedPayroll({
          employmentId: employmentId.value,
          revision: props.data.revision,
          record: pdfRecord.value,
          documentHash: pdfHash.value,
          previewOnly,
          reviewConfirmed: true,
        })
      : await importPayroll({
          employmentId: employmentId.value,
          source: 'adp',
          content: content.value,
          revision: props.data.revision,
          previewOnly,
        });
    preview.value = result;
    if (!previewOnly) {
      notice.value = `Imported ${result.inserted} statements; updated ${result.updated}; ${result.duplicates} unchanged; ${result.rejected} rejected.`;
      content.value = '';
      fileName.value = '';
      await saved();
      if (!result.rejected) section.value = null;
    }
  } catch {
    error.value =
      'Payroll import was not completed. Check the file and selected employment, then reload if another session changed the records.';
  } finally {
    busy.value = false;
  }
}
const selectedReconciliation = computed(() =>
  props.data.reconciliation.find((r) => r.statementId === selectedStatement.value?.id),
);
function selectStatement(statement: PayrollStatement) {
  selectedStatement.value = statement;
  depositSelections.value = [...statement.depositIds];
}
async function linkDeposits() {
  if (!selectedStatement.value) return;
  busy.value = true;
  error.value = '';
  try {
    await linkPayrollDeposits({
      revision: props.data.revision,
      statementId: selectedStatement.value.id,
      depositIds: depositSelections.value,
    });
    await saved();
    selectedStatement.value = null;
    notice.value = 'Deposit links saved. No bank transactions were created.';
  } catch {
    error.value = 'Deposit links were not saved. Select matching deposits whose sum equals the paycheck net amount.';
  } finally {
    busy.value = false;
  }
}
async function reconcileRetirement(previewOnly: boolean) {
  if (!employmentId.value || !retirementAccountId.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await reconcilePayrollRetirement({
      employmentId: employmentId.value,
      accountId: retirementAccountId.value,
      previewOnly,
      previewToken: previewOnly ? undefined : retirementPreview.value?.previewToken,
    });
    retirementPreview.value = result;
    if (!previewOnly) {
      await saved();
      await client.invalidateQueries({
        predicate: (q) => q.queryKey.some((k) => typeof k === 'string' && /personal.?finance/i.test(k)),
      });
      section.value = null;
    }
  } catch {
    error.value =
      'Retirement reconciliation was not applied. Preview again; source or principal records may have changed.';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Dialog v-model:open="open"
    ><DialogScrollContent class="max-w-4xl"
      ><DialogHeader
        ><DialogTitle>{{ titles[section ?? 'settings'] }}</DialogTitle
        ><DialogDescription>{{
          section === 'sync'
            ? 'Secure, user-initiated updates. Payroll credentials stay with ADP.'
            : section === 'employment'
              ? 'Manage employers and positions without removing existing paychecks.'
              : section === 'salary'
                ? 'Record earlier salaries or correct event details. Payroll source records remain preserved.'
                : 'Review actual payroll and source records.'
        }}</DialogDescription></DialogHeader
      >
      <Callout v-if="error" variant="destructive">{{ error }}</Callout
      ><Callout v-if="notice">{{ notice }}</Callout>
      <template v-if="section === 'sync'"
        ><div class="space-y-4 text-sm">
          <p>
            Open the official ADP site and authenticate there, including MFA. Export your detailed payroll JSON, then
            import it here. Updates run only when you initiate them; no background ADP synchronization occurs.
          </p>
          <Button as-child variant="outline"
            ><a href="https://my.adp.com/" target="_blank" rel="noopener noreferrer">Open ADP</a></Button
          >
          <details class="rounded-md border p-3">
            <summary class="hover:text-primary-text cursor-pointer font-medium">
              Optional interactive local export helper
            </summary>
            <p class="text-muted-foreground mt-2">
              On your own computer with this repository, run
              <code class="text-foreground">node scripts/export-adp-payroll.mjs</code>. Sign in inside the local
              browser, approve export, and import the resulting JSON here. The temporary authenticated browser closes
              when the export finishes or fails. See <code>docs/PAYROLL-ADP-EXPORT.md</code>.
            </p>
          </details>
          <div class="divide-border/50 divide-y">
            <p class="flex justify-between gap-3 py-2">
              <span class="text-muted-foreground">Last successful import</span
              ><span>{{ data.status.lastSuccessfulImport?.slice(0, 10) ?? 'Not yet imported' }}</span>
            </p>
            <p class="flex justify-between gap-3 py-2">
              <span class="text-muted-foreground">Latest paycheck</span
              ><span>{{ data.status.latestPaycheck ?? 'Unavailable' }}</span>
            </p>
            <p class="flex justify-between gap-3 py-2">
              <span class="text-muted-foreground">Imported statements</span
              ><span>{{ data.status.statementCount }}</span>
            </p>
          </div>
          <Button @click="section = 'import'">Import payroll JSON</Button>
        </div></template
      >
      <template v-if="section === 'import'"
        ><div class="space-y-4">
          <label class="block space-y-1 text-sm"
            >Employment<select v-model="employmentId" :class="field" @change="preview = null">
              <option value="" disabled>Choose employment</option>
              <option v-for="employment in data.employments" :key="employment.id" :value="employment.id">
                {{ employment.employerName }} · {{ employment.jobTitle || 'Employment' }}
              </option>
            </select></label
          >
          <p class="text-muted-foreground text-xs">
            Associate statements with their actual employment. Preview the date ranges and amounts before saving.
            Statement IDs are preserved for duplicate and correction checks.
          </p>
          <input type="file" accept=".json,.pdf,application/json,application/pdf" class="text-sm" @change="readFile" />
          <Button size="sm" variant="ghost" :disabled="!employmentId || busy" @click="newManual"
            >Enter a manual paycheck</Button
          >
          <div v-if="pdfRecord" class="space-y-3 rounded-lg border p-4" @input="preview = null">
            <p class="text-sm font-medium">
              Review the {{ pdfRecord.source === 'pdf' ? 'PDF extraction' : 'manual paycheck' }}
            </p>
            <p class="text-muted-foreground text-xs">
              Verify every amount against the paystub. Unknown fields must stay incomplete; direct deposit distributions
              are not expenses.
            </p>
            <p v-for="(issue, i) in pdfIssues" :key="i" class="text-muted-foreground text-xs">{{ issue }}</p>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="space-y-1 text-xs"
                >Pay date<input v-model="pdfRecord.date" type="date" required :class="field" /></label
              ><label class="space-y-1 text-xs"
                >Gross earnings<input
                  v-model.number="pdfRecord.gross"
                  type="number"
                  step="0.01"
                  required
                  :class="field" /></label
              ><label class="space-y-1 text-xs"
                >Take-home pay<input
                  v-model.number="pdfRecord.net"
                  type="number"
                  step="0.01"
                  required
                  :class="field" /></label
              ><label class="space-y-1 text-xs"
                >Bonuses<input v-model.number="pdfRecord.bonus" type="number" step="0.01" :class="field" /></label
              ><label class="space-y-1 text-xs"
                >Period start<input v-model="pdfRecord.periodStart" type="date" :class="field" /></label
              ><label class="space-y-1 text-xs"
                >Period end<input v-model="pdfRecord.periodEnd" type="date" :class="field" /></label
              ><label v-for="tax in taxFields" :key="tax.key" class="space-y-1 text-xs"
                >{{ tax.name
                }}<input v-model.number="pdfRecord[tax.key]" type="number" step="0.01" :class="field" /></label
              ><label class="space-y-1 text-xs"
                >Employer retirement total<input
                  v-model.number="pdfRecord.employerContributions"
                  type="number"
                  step="0.01"
                  :class="field"
              /></label>
            </div>
            <label class="flex items-center gap-2 text-xs"
              ><input v-model="pdfRecord.withholdingComplete" type="checkbox" />All tax withholding fields are verified
              and complete</label
            >
            <div v-for="(deduction, i) in pdfRecord.deductions" :key="i" class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <input v-model="deduction.name" placeholder="Deduction name" :class="field" /><input
                v-model.number="deduction.amount"
                type="number"
                step="0.01"
                placeholder="Amount"
                :class="field"
              /><select v-model="deduction.treatment" :class="field">
                <option value="pre-tax">Pre-tax</option>
                <option value="post-tax">Post-tax</option>
              </select>
            </div>
            <Button
              size="sm"
              variant="outline"
              @click="pdfRecord.deductions.push({ name: '', amount: 0, treatment: 'post-tax' })"
              >Add retirement / other deduction</Button
            >
            <label class="block space-y-1 text-xs"
              >Source / review notes<textarea
                v-model="pdfRecord.notes"
                class="border-input bg-background min-h-16 w-full rounded-md border p-2 text-sm"
              /></label
            ><label class="flex items-center gap-2 text-sm"
              ><input v-model="pdfReviewed" type="checkbox" />I verified this paycheck against the source</label
            >
          </div>
          <Button
            :disabled="(!content && !pdfRecord) || !employmentId || busy || (!!pdfRecord && !pdfReviewed)"
            @click="runImport(true)"
            >{{ busy ? 'Validating…' : 'Preview import' }}</Button
          >
          <div v-if="preview" class="space-y-3 rounded-lg border p-4">
            <p class="font-medium">
              {{ preview.inserted }} new · {{ preview.updated }} updated · {{ preview.duplicates }} unchanged ·
              {{ preview.rejected }} rejected
            </p>
            <ul
              v-if="preview.issues.length"
              class="text-muted-foreground max-h-32 list-inside list-disc overflow-y-auto text-xs"
            >
              <li v-for="(issue, i) in preview.issues" :key="i">{{ issue }}</li>
            </ul>
            <div class="max-h-64 overflow-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr class="text-muted-foreground border-b">
                    <th class="p-2 text-left">Pay date</th>
                    <th class="p-2 text-right">Gross</th>
                    <th class="p-2 text-right">Take-home</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="statement in preview.statements" :key="statement.statementId" class="border-b">
                    <td class="p-2">{{ statement.payDate }}<span v-if="statement.adjustment"> · Adjustment</span></td>
                    <td class="p-2 text-right">{{ money(statement.totals.gross) }}</td>
                    <td class="p-2 text-right">{{ money(statement.totals.net) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Button :disabled="busy || (!content && !pdfRecord)" @click="runImport(false)">{{
              busy ? 'Importing…' : `Import ${fileName}`
            }}</Button>
          </div>
          <Button size="sm" variant="ghost" @click="section = 'legacy'">Manual and PDF paycheck records</Button>
        </div></template
      >
      <template v-if="section === 'employment' && draft"
        ><form class="space-y-4" @submit.prevent="save">
          <div
            v-for="(employment, i) in draft.employments"
            :key="employment.id"
            class="space-y-4 rounded-lg border p-4"
          >
            <h3 class="font-medium">{{ employment.employerName || `Employment ${i + 1}` }}</h3>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="space-y-1 text-xs"
                >Employer<input v-model="employment.employerName" required :class="field" /></label
              ><label class="space-y-1 text-xs"
                >Position / job title<input v-model="employment.jobTitle" :class="field" /></label
              ><label class="space-y-1 text-xs"
                >Employment start<input v-model="employment.startDate" type="date" :class="field" /></label
              ><label class="space-y-1 text-xs"
                >Employment end<input v-model="employment.endDate" type="date" :class="field" /></label
              ><label class="space-y-1 text-xs"
                >Position start<input v-model="employment.positionStartDate" type="date" :class="field" /></label
              ><label class="space-y-1 text-xs"
                >Position end<input v-model="employment.positionEndDate" type="date" :class="field" /></label
              ><label class="space-y-1 text-xs"
                >Status<select v-model="employment.status" :class="field">
                  <option value="current">Current</option>
                  <option value="previous">Previous</option>
                </select></label
              ><label class="space-y-1 text-xs"
                >Payroll source<input v-model="employment.source" :class="field" /></label
              ><label class="space-y-1 text-xs"
                >Pay frequency<select v-model="employment.payFrequency" :class="field">
                  <option
                    v-for="frequency in ['weekly', 'biweekly', 'semimonthly', 'monthly', 'annual']"
                    :key="frequency"
                  >
                    {{ frequency }}
                  </option>
                </select></label
              ><label class="space-y-1 text-xs"
                >Compensation type<select v-model="employment.compensationType" :class="field">
                  <option value="salary">Salary</option>
                  <option value="hourly">Hourly</option>
                </select></label
              ><label v-if="employment.compensationType === 'hourly'" class="space-y-1 text-xs"
                >Verified annual working hours<input
                  v-model.number="employment.annualHours"
                  type="number"
                  min="1"
                  :class="field" /></label
              ><label class="space-y-1 text-xs"
                >Manually verified annual salary (optional)<input
                  v-model.number="employment.manualAnnualSalary"
                  type="number"
                  min="0"
                  step="0.01"
                  :class="field"
              /></label>
            </div>
            <label class="block space-y-1 text-xs"
              >Career notes<textarea
                v-model="employment.notes"
                class="border-input bg-background min-h-20 w-full rounded-md border p-3 text-sm"
              />
            </label>
          </div>
          <div class="flex justify-between gap-3">
            <Button type="button" variant="outline" @click="addEmployment">Add employment / position</Button
            ><Button type="submit" :disabled="busy">Save changes</Button>
          </div>
        </form></template
      >
      <template v-if="section === 'salary' && draft"
        ><div class="space-y-4">
          <Button size="sm" variant="outline" :disabled="!data.employments.length" @click="editSalary()"
            >Add earlier salary</Button
          >
          <form v-if="salaryEdit" class="space-y-3 rounded-lg border p-4" @submit.prevent="keepSalary">
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="space-y-1 text-xs"
                >Employment<select v-model="salaryEdit.employmentId" required :class="field">
                  <option v-for="employment in data.employments" :key="employment.id" :value="employment.id">
                    {{ employment.employerName }} · {{ employment.jobTitle }}
                  </option>
                </select></label
              ><label class="space-y-1 text-xs"
                >Annualized base salary<input
                  v-model.number="salaryEdit.salary"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  :class="field" /></label
              ><label class="space-y-1 text-xs"
                >Recorded date<input
                  v-model="salaryEdit.date"
                  type="date"
                  required
                  :max="payrollToday()"
                  :class="field" /></label
              ><label class="space-y-1 text-xs"
                >Verified effective date (optional)<input
                  v-model="salaryEdit.effectiveDate"
                  type="date"
                  :max="payrollToday()"
                  :class="field" /></label
              ><label class="space-y-1 text-xs"
                >First observed paycheck date<input
                  v-model="salaryEdit.firstObservedDate"
                  type="date"
                  :max="payrollToday()"
                  :class="field" /></label
              ><label class="space-y-1 text-xs"
                >Event<select v-model="salaryEdit.kind" :class="field">
                  <option
                    v-for="kind in ['starting', 'raise', 'decrease', 'promotion', 'employment', 'correction']"
                    :key="kind"
                  >
                    {{ kind }}
                  </option>
                </select></label
              ><label class="space-y-1 text-xs">Job title<input v-model="salaryEdit.jobTitle" :class="field" /></label
              ><label class="space-y-1 text-xs">Annotation<input v-model="salaryEdit.notes" :class="field" /></label>
            </div>
            <Button type="submit" size="sm">Keep change</Button>
          </form>
          <div class="divide-border/50 max-h-80 divide-y overflow-auto">
            <button
              v-for="event in [
                ...data.salaryEvents,
                ...draft.manualSalaryEvents.filter((e) => !data.salaryEvents.some((s) => s.id === e.id)),
              ]"
              :key="event.id"
              class="hover:bg-accent flex w-full items-center justify-between gap-4 rounded-md p-3 text-left text-sm"
              @click="editSalary(event)"
            >
              <span
                >{{ event.date }} · {{ event.employerName
                }}<span class="text-muted-foreground block text-xs"
                  >{{ event.kind }} ·
                  {{ event.effectiveDate ? 'Verified effective date' : 'First observed date' }}</span
                ></span
              ><b>{{ money(event.salary) }}</b>
            </button>
          </div>
          <Button :disabled="busy || !!salaryEdit" @click="save">Save changes</Button>
        </div></template
      >
      <template v-if="section === 'settings' && draft"
        ><form class="space-y-4" @submit.prevent="save">
          <label class="block space-y-1 text-sm"
            >Remind me to update payroll every (days)<input
              v-model.number="draft.settings.reminderDays"
              type="number"
              min="1"
              max="365"
              required
              :class="field" /></label
          ><label class="flex items-center gap-2 text-sm"
            ><input v-model="draft.settings.reminderDismissed" type="checkbox" />Dismiss payroll update reminders</label
          >
          <p class="text-muted-foreground text-xs">
            Reminders do not start background synchronization. Existing bank sync schedules remain unchanged.
          </p>
          <Button type="submit" :disabled="busy">Save changes</Button>
        </form></template
      >
      <template v-if="section === 'history'"
        ><div class="space-y-3 text-sm">
          <p class="text-muted-foreground">
            Interactive local export and file import. No background ADP connection is stored.
          </p>
          <div v-for="run in data.status.history" :key="run.id" class="rounded-lg border p-3">
            <p class="font-medium">
              {{ run.at.slice(0, 16).replace('T', ' ') }} · {{ employerName(run.employmentId) }}
            </p>
            <p class="text-muted-foreground mt-1 text-xs">
              {{ run.inserted }} new · {{ run.updated }} updated · {{ run.duplicates }} unchanged ·
              {{ run.rejected }} rejected
            </p>
            <details v-if="run.issues.length" class="mt-2 text-xs">
              <summary class="cursor-pointer">Import notes</summary>
              <p v-for="(issue, i) in run.issues" :key="i" class="mt-1">{{ issue }}</p>
            </details>
          </div>
          <p v-if="!data.status.history.length">No payroll imports yet.</p>
        </div></template
      >
      <template v-if="section === 'paychecks'"
        ><div class="space-y-3">
          <div v-if="!selectedStatement" class="max-h-[65vh] overflow-auto">
            <table class="w-full text-sm">
              <thead class="text-muted-foreground border-b">
                <tr>
                  <th class="p-2 text-left">Paycheck</th>
                  <th class="p-2 text-right">Gross</th>
                  <th class="p-2 text-right">Take-home</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="statement in [...data.statements].reverse()"
                  :key="statement.id"
                  tabindex="0"
                  class="hover:bg-accent cursor-pointer border-b"
                  @click="selectStatement(statement)"
                  @keydown.enter="selectStatement(statement)"
                >
                  <td class="p-2">
                    {{ statement.payDate
                    }}<span class="text-muted-foreground block text-xs"
                      >{{ employerName(statement.employmentId)
                      }}<template v-if="statement.adjustment"> · Adjustment</template></span
                    >
                  </td>
                  <td class="p-2 text-right tabular-nums">{{ money(statement.totals.gross) }}</td>
                  <td class="p-2 text-right tabular-nums">{{ money(statement.totals.net) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <template v-else
            ><Button variant="ghost" size="sm" @click="selectedStatement = null">Back to paychecks</Button>
            <p class="font-medium">
              {{ selectedStatement.payDate }} · {{ employerName(selectedStatement.employmentId) }}
            </p>
            <p class="text-muted-foreground text-xs">
              {{ selectedStatement.periodStart }}–{{ selectedStatement.periodEnd }} · Source
              {{ selectedStatement.source }} · Revision {{ selectedStatement.version }}
            </p>
            <dl class="divide-border/50 divide-y text-sm">
              <div
                v-for="item in [
                  { label: 'Gross', value: selectedStatement.totals.gross },
                  { label: 'Take-home', value: selectedStatement.totals.net },
                  { label: 'Employer retirement', value: selectedStatement.totals.employerRetirement },
                ]"
                :key="item.label"
                class="flex justify-between py-2"
              >
                <dt>{{ item.label }}</dt>
                <dd>{{ money(item.value) }}</dd>
              </div>
            </dl>
            <details
              v-for="group in [
                { name: 'Earnings', rows: selectedStatement.earnings },
                { name: 'Deductions', rows: selectedStatement.deductions },
                { name: 'Employer memos', rows: selectedStatement.memos },
              ]"
              :key="group.name"
              class="rounded-md border p-3"
            >
              <summary class="hover:text-primary-text cursor-pointer text-sm">{{ group.name }}</summary>
              <div v-for="(line, i) in group.rows" :key="i" class="flex justify-between gap-4 border-b py-2 text-xs">
                <span
                  >{{ line.name
                  }}<span class="text-muted-foreground block"
                    >{{ line.category
                    }}<template v-if="line.preTax != null">
                      · {{ line.preTax ? 'Pre-tax' : 'Post-tax' }}</template
                    ></span
                  ></span
                ><span class="text-right"
                  >{{ money(line.amount)
                  }}<span v-if="line.ytd != null" class="text-muted-foreground block"
                    >YTD {{ money(line.ytd) }}</span
                  ></span
                >
              </div>
            </details>
            <p v-for="issue in selectedStatement.issues" :key="issue" class="text-muted-foreground text-xs">
              {{ issue }}
            </p>
            <section class="rounded-md border p-3">
              <h3 class="text-sm font-medium">Reconcile bank deposits</h3>
              <p class="text-muted-foreground mt-1 text-xs">
                Select the matching deposit or split deposits. Their total must equal take-home pay. Linking explains
                existing deposits without creating income twice.
              </p>
              <label
                v-for="candidate in selectedReconciliation?.candidates"
                :key="candidate.id"
                class="mt-2 flex items-center gap-2 text-xs"
                ><input v-model="depositSelections" type="checkbox" :value="candidate.id" /><span
                  >{{ candidate.date }} · {{ candidate.description }} · {{ money(candidate.amount) }}</span
                ></label
              >
              <p v-if="selectedStatement.depositIds.length" class="text-muted-foreground mt-2 text-xs">
                {{ selectedStatement.depositIds.length }} verified deposit link(s) saved.
              </p>
              <Button
                v-if="selectedReconciliation?.candidates.length"
                size="sm"
                class="mt-3"
                :disabled="busy || !depositSelections.length"
                @click="linkDeposits"
                >Save deposit links</Button
              >
            </section></template
          ><Button size="sm" variant="ghost" @click="section = 'legacy'">Manual and PDF paycheck records</Button>
        </div></template
      >
      <template v-if="section === 'retirement'"
        ><div class="space-y-4">
          <p class="text-muted-foreground text-sm">
            Choose the retirement account funded by this employment. Payroll contributions are matched to existing
            principal before adding any new amounts. Current account balances are unchanged.
          </p>
          <label class="block space-y-1 text-sm"
            >Employment<select v-model="employmentId" :class="field">
              <option value="" disabled>Choose employment</option>
              <option v-for="employment in data.employments" :key="employment.id" :value="employment.id">
                {{ employment.employerName }} · {{ employment.jobTitle || 'Employment' }}
              </option>
            </select></label
          ><label class="block space-y-1 text-sm"
            >Retirement reporting account<select v-model="retirementAccountId" :class="field">
              <option value="" disabled>Choose retirement account</option>
              <option v-for="account in retirementAccounts" :key="account.id" :value="account.id">
                {{ account.name }}
              </option>
            </select></label
          >
          <p v-if="finance.isError.value" class="text-destructive-text text-xs">
            Retirement accounts could not be loaded.
          </p>
          <Button
            :disabled="busy || !employmentId || !retirementAccountId"
            variant="outline"
            @click="reconcileRetirement(true)"
            >{{ busy ? 'Checking…' : 'Preview contribution reconciliation' }}</Button
          >
          <div v-if="retirementPreview" class="space-y-3 rounded-lg border p-4">
            <p class="text-sm">
              Employee {{ money(retirementPreview.totals.employee) }} · Employer
              {{ money(retirementPreview.totals.employer) }} · Total {{ money(retirementPreview.totals.total) }}
            </p>
            <div class="max-h-72 overflow-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr class="border-b">
                    <th class="p-2 text-left">Pay date</th>
                    <th class="p-2 text-right">Amount</th>
                    <th class="p-2 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="action in retirementPreview.actions" :key="action.date" class="border-b">
                    <td class="p-2">{{ action.date }}</td>
                    <td class="p-2 text-right tabular-nums">{{ money(action.amount) }}</td>
                    <td class="p-2">
                      <span :class="['font-medium', action.status === 'conflict' ? 'text-destructive-text' : '']">{{
                        action.status
                      }}</span>
                      <p v-if="action.reason" class="text-muted-foreground mt-1">{{ action.reason }}</p>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="text-muted-foreground text-xs">
              Covered or conflicting amounts stay unchanged for review. Matching and duplicate checks prevent counting
              contributions twice.
            </p>
            <Button
              :disabled="
                busy || !retirementPreview.actions.some((a) => ['insert', 'link', 'update'].includes(a.status))
              "
              @click="reconcileRetirement(false)"
              >Apply verified contributions</Button
            >
          </div>
        </div></template
      >
      <LegacyPaychecks v-if="section === 'legacy'" /> </DialogScrollContent
  ></Dialog>
</template>
