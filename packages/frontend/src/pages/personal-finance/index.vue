<script setup lang="ts">
import { loadAccounts } from '@/api/accounts';
import {
  commitFinanceImport,
  correctFinancePrincipal,
  getPersonalFinanceDashboard,
  previewFinanceImport,
  saveFinanceAccount,
  saveFinanceCashFlow,
  saveFinanceCategories,
  saveFinanceSnapshot,
  type CashFlowType,
  type FinanceAccount,
  type FinanceCategory,
  type FinanceDashboard,
  type FinanceHistoryPoint,
  type FinanceCashFlow,
  type HistoryImportPayload,
  type HistoryImportPreview,
} from '@/api/personal-finance';
import PageWrapper from '@/components/common/page-wrapper.vue';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Card } from '@/components/lib/ui/card';
import { Dialog, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/lib/ui/dialog';
import { ROUTES_NAMES } from '@/routes/constants';
import {
  ArrowDownUpIcon,
  ChartLineIcon,
  CheckIcon,
  DownloadIcon,
  PlusIcon,
  RefreshCwIcon,
  Settings2Icon,
  UploadIcon,
  WalletIcon,
} from '@lucide/vue';
import { format, subMonths } from 'date-fns';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import FinanceChart, { type ChartRow, type ChartSeries } from './finance-chart.vue';
import { mapHistoryRecords, parseHistoryFile, type UnmappedHistoryRecord } from './history-import';
import { recordedCategoryBalance, recordedNetWorth } from './history-display';
import { accountManagementLabel, recordedPrincipal, valuationSourceLabel } from './balance-display';
import SheetsSyncPanel from './sheets-sync-panel.vue';
import PrincipalReviewPanel from './principal-review-panel.vue';

const queryClient = useQueryClient();
const route = useRoute();
const data = ref<FinanceDashboard | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const period = ref('all');
const sourceView = ref<'all' | 'personal'>('all');
const throughDate = ref('');
const granularity = ref<'daily' | 'monthly'>('monthly');
const chart = ref('total');
const selectedAccount = ref('');
const activePanel = ref<'accounts' | 'snapshot' | 'cashflow' | 'import' | 'categories' | null>(null);
const nativeAccounts = ref<Array<{ id: string; name: string; currencyCode: string }>>([]);
const today = () => format(new Date(), 'yyyy-MM-dd');
const periodAnchor = () => (throughDate.value ? new Date(`${throughDate.value}T12:00:00`) : new Date());
const newFlowKey = () => `manual:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
const accountForm = reactive({
  id: '',
  name: '',
  currencyCode: 'USD',
  categoryId: 'spendable',
  included: true,
  balanceKind: 'asset' as 'asset' | 'liability',
  nativeAccountIds: [] as string[],
  preferredSource: 'manual',
});
const snapshotForm = reactive({ accountId: '', date: today(), balance: '', description: '' });
const snapshotFormElement = ref<HTMLFormElement | null>(null);
const flowCorrectionId = ref('');
const ledgerOpen = ref(false);
const ledgerElement = ref<HTMLDetailsElement | null>(null);
const flowForm = reactive({
  accountId: '',
  date: today(),
  amount: '',
  type: 'contribution' as CashFlowType,
  toAccountId: '',
  description: '',
  opening: false,
  contributionKind: 'unspecified' as 'employee' | 'employer' | 'unspecified',
  idempotencyKey: newFlowKey(),
});
const categoryDraft = ref<FinanceCategory[]>([]);
const fileName = ref('');
const sourceId = ref('');
const importRecords = ref<UnmappedHistoryRecord[]>([]);
const importMapping = reactive<Record<string, string>>({});
const skippedBlank = ref(0);
const preview = ref<HistoryImportPreview | null>(null);
const previewPayload = ref<HistoryImportPayload | null>(null);
const importLabels = computed(() => [...new Set(importRecords.value.map((r) => r.accountName))]);
const included = computed(() => data.value?.accounts.filter((a) => a.included) ?? []);
const currency = computed(() => data.value?.currencyCode ?? 'USD');
const money = (value: number | null | undefined, code = currency.value) =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(value);
const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
const changeAmount = (value: FinanceDashboard['monthlyChange']) =>
  typeof value === 'number' ? value : (value?.amount ?? null);
const history = computed(() => data.value?.history ?? []);
const allMissing = computed(() =>
  included.value.filter((a) => history.value.at(-1)?.missingAccountIds.includes(a.id) || a.latestBalance === null),
);
const categoryById = (id: string) => data.value?.categories.find((c) => c.id === id);
const accountById = (id: string) => data.value?.accounts.find((a) => a.id === id);
const changePercent = (value: FinanceDashboard['monthlyChange']) =>
  typeof value === 'object' && value !== null ? value.percent : null;
const addCategory = () =>
  categoryDraft.value.push({
    id: `category-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: 'New category',
    color: '#3b82f6',
  });
const chartOptions = [
  ['total', 'Total net worth'],
  ['categories', 'Category history'],
  ['account', 'Account history'],
  ['monthly', 'Monthly dollar change'],
  ['percent', 'Monthly percentage change'],
  ['principal', 'Principal vs. value'],
  ['gains', 'Gain by account'],
  ['savings', 'Savings growth'],
  ['allocation', 'Category allocation'],
];
const accountIsRequired = computed(() => ['account', 'principal'].includes(chart.value));
const chartCurrency = computed(() =>
  accountIsRequired.value ? (accountById(selectedAccount.value)?.currencyCode ?? currency.value) : currency.value,
);
const categoryTotal = (id: string) => {
  const point = history.value.at(-1);
  return point ? recordedCategoryBalance(point, included.value, id) : null;
};
const categoryPartial = (id: string) =>
  included.value.some((a) => a.categoryId === id && history.value.at(-1)?.missingAccountIds.includes(a.id));
const chartModel = computed(
  (): { rows: ChartRow[]; series: ChartSeries[]; mode: 'line' | 'stacked' | 'bar' | 'donut'; percentage?: boolean } => {
    const categories = data.value?.categories ?? [];
    const catSeries = categories.map((c) => ({ id: c.id, name: c.name, color: c.color }));
    const rows = history.value.map((p) => ({
      label: p.date,
      values: Object.fromEntries(
        categories.map((c) => {
          return [c.id, recordedCategoryBalance(p, included.value, c.id)];
        }),
      ),
      partial: !p.complete,
    }));
    if (chart.value === 'categories') return { rows, series: catSeries, mode: 'stacked' };
    if (chart.value === 'allocation') return { rows: rows.slice(-1), series: catSeries, mode: 'donut' };
    if (chart.value === 'savings') {
      const savings = categories.find((c) => c.id === 'savings');
      return {
        rows,
        series: savings ? [{ id: savings.id, name: savings.name, color: savings.color }] : [],
        mode: 'line',
      };
    }
    if (chart.value === 'gains')
      return {
        rows: (data.value?.accounts ?? [])
          .filter((a) => a.included && ['investments', 'retirement', 'savings'].includes(a.categoryId))
          .map((a) => ({ label: a.name, values: { gain: a.gain } })),
        series: [{ id: 'gain', name: 'Contribution-based gain', color: 'var(--app-income-color)' }],
        mode: 'bar',
      };
    if (chart.value === 'monthly' || chart.value === 'percent') {
      const points = new Map<string, (typeof history.value)[number]>();
      history.value.forEach((p) => points.set(p.date.slice(0, 7), p));
      const monthly = [...points.values()];
      return {
        rows: monthly.map((p, i) => {
          const previous = monthly[i - 1];
          const adjacent =
            previous &&
            format(subMonths(new Date(`${p.date.slice(0, 7)}-15T12:00:00`), 1), 'yyyy-MM') ===
              previous.date.slice(0, 7);
          const change =
            adjacent && p.complete && previous.complete && p.total !== null && previous.total !== null
              ? p.total - previous.total
              : null;
          return {
            label: p.date.slice(0, 7),
            values: {
              change:
                chart.value === 'percent'
                  ? change !== null && previous?.total
                    ? (change / Math.abs(previous.total)) * 100
                    : null
                  : change,
            },
            partial: !p.complete,
          };
        }),
        series: [
          {
            id: 'change',
            name: chart.value === 'percent' ? 'Monthly change (%)' : 'Monthly change',
            color: 'var(--app-income-color)',
          },
        ],
        mode: 'bar',
        percentage: chart.value === 'percent',
      };
    }
    if (accountIsRequired.value) {
      const account = accountById(selectedAccount.value);
      const flows = (data.value?.cashFlows ?? [])
        .filter((f) => f.accountId === selectedAccount.value || f.toAccountId === selectedAccount.value)
        .sort((a, b) => a.date.localeCompare(b.date));
      const recorded = (data.value?.snapshots ?? []).filter((s) => s.accountId === selectedAccount.value);
      const buckets = new Map<string, (typeof recorded)[number]>();
      recorded.forEach((s) => {
        const key = granularity.value === 'monthly' ? s.date.slice(0, 7) : s.date;
        const prior = buckets.get(key);
        if (!prior || s.date > prior.date) buckets.set(key, s);
      });
      const from =
        period.value === 'all' ? null : format(subMonths(periodAnchor(), Number(period.value)), 'yyyy-MM-dd');
      const accountRows: ChartRow[] = [...buckets.values()]
        .filter((s) => !from || s.date >= from)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((p) => {
          const principal = recordedPrincipal(selectedAccount.value, flows, p.date);
          return { label: p.date, values: { value: p.balance, principal } };
        });
      return {
        rows: accountRows,
        series: [
          { id: 'value', name: account?.name ?? 'Account value', color: 'var(--primary)' },
          ...(chart.value === 'principal'
            ? [{ id: 'principal', name: 'Net contributed principal', color: 'var(--app-savings-color)' }]
            : []),
        ],
        mode: 'line',
      };
    }
    return {
      rows: history.value.map((p) => ({ label: p.date, values: { total: recordedNetWorth(p) }, partial: !p.complete })),
      series: [{ id: 'total', name: 'Net worth', color: 'var(--primary)' }],
      mode: 'line',
    };
  },
);

const detailOpen = ref(false);
const detailScope = ref<'all' | 'category' | 'account'>('all');
const detailId = ref('');
const detailDate = ref('');
const detailTitle = computed(() =>
  detailScope.value === 'account'
    ? `${accountById(detailId.value)?.name ?? 'Account'} history`
    : detailScope.value === 'category'
      ? `${categoryById(detailId.value)?.name ?? 'Category'} details`
      : 'Net worth details',
);
const detailAccounts = computed(() =>
  (data.value?.accounts ?? []).filter((a) =>
    detailScope.value === 'account'
      ? a.id === detailId.value
      : a.included && (detailScope.value === 'all' || a.categoryId === detailId.value),
  ),
);
const detailPoints = computed<FinanceHistoryPoint[]>(() => {
  if (detailScope.value === 'account') {
    const buckets = new Map<string, NonNullable<FinanceDashboard['snapshots']>[number]>();
    for (const s of data.value?.snapshots ?? []) {
      if (s.accountId !== detailId.value) continue;
      const key = granularity.value === 'monthly' ? s.date.slice(0, 7) : s.date;
      if (!buckets.has(key) || buckets.get(key)!.date < s.date) buckets.set(key, s);
    }
    return [...buckets.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => ({
        date: s.date,
        total: s.balance,
        knownTotal: s.balance,
        complete: true,
        missingAccountIds: [],
        balances: { [s.accountId]: s.balance },
        valuationDates: { [s.accountId]: s.date },
        categories: {},
      }));
  }
  return history.value.map((p) => {
    const missingAccountIds = detailAccounts.value
      .filter(
        (a) =>
          !p.inactiveAccountIds?.includes(a.id) &&
          (p.balances[a.id] === null || p.balances[a.id] === undefined || a.currencyCode !== currency.value),
      )
      .map((a) => a.id);
    const knownTotal =
      detailAccounts.value.reduce((sum, a) => {
        const value = p.balances[a.id];
        return (
          sum +
          (value === null || value === undefined || a.currencyCode !== currency.value
            ? 0
            : Math.round((a.balanceKind === 'liability' ? -Math.abs(value) : value) * 100))
        );
      }, 0) / 100;
    return {
      ...p,
      knownTotal,
      total: missingAccountIds.length ? null : knownTotal,
      missingAccountIds,
      complete: !missingAccountIds.length,
    };
  });
});
const detailPoint = computed(
  () => detailPoints.value.find((p) => p.date === detailDate.value) ?? detailPoints.value.at(-1),
);
const detailChartRows = computed<ChartRow[]>(() =>
  detailPoints.value.map((p) => ({
    label: p.date,
    values: {
      balance: detailAccounts.value.some((a) => p.balances[a.id] !== null && p.balances[a.id] !== undefined)
        ? recordedNetWorth(p)
        : null,
    },
    partial: !p.complete,
  })),
);
const detailCurrency = computed(() =>
  detailScope.value === 'account' ? (detailAccounts.value[0]?.currencyCode ?? currency.value) : currency.value,
);
function openDetails(scope: 'all' | 'category' | 'account', id = '', date = '') {
  detailScope.value = scope;
  detailId.value = id;
  detailDate.value = date;
  detailOpen.value = true;
}
function selectChartPoint(row: ChartRow) {
  const account = data.value?.accounts.find((a) => a.name === row.label);
  if (account) {
    openDetails('account', account.id);
    return;
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(row.label)
    ? row.label
    : history.value.find((p) => p.date.slice(0, 7) === row.label)?.date;
  if (!date) return;
  openDetails(accountIsRequired.value ? 'account' : 'all', accountIsRequired.value ? selectedAccount.value : '', date);
}

let requestId = 0;
async function reload() {
  const id = ++requestId;
  loading.value = true;
  error.value = '';
  try {
    const result = await getPersonalFinanceDashboard({
      mode: sourceView.value,
      granularity: granularity.value,
      ...(throughDate.value ? { to: throughDate.value } : {}),
      ...(period.value === 'all'
        ? {}
        : { from: format(subMonths(periodAnchor(), Number(period.value)), 'yyyy-MM-dd') }),
    });
    if (id !== requestId) return;
    data.value = result;
    categoryDraft.value = result.categories.map((c) => ({ ...c }));
    if (!selectedAccount.value || !result.accounts.some((a) => a.id === selectedAccount.value))
      selectedAccount.value = result.accounts[0]?.id ?? '';
    if (!snapshotForm.accountId) snapshotForm.accountId = result.accounts[0]?.id ?? '';
    if (!flowForm.accountId) flowForm.accountId = result.accounts[0]?.id ?? '';
  } catch (e) {
    if (id === requestId) error.value = e instanceof Error ? e.message : 'Could not load your dashboard.';
  } finally {
    if (id === requestId) loading.value = false;
  }
}
async function mutate(action: () => Promise<unknown>, message: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await action();
    notice.value = message;
    await refreshBalances();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'The change could not be saved.';
  } finally {
    busy.value = false;
  }
}
async function refreshBalances() {
  await reload();
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['bank-account-imported-history'] }),
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.widgetBalanceTrend }),
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.widgetBalanceTrendPrev }),
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.widgetNetWorth }),
  ]);
}
function editAccount(account?: FinanceAccount) {
  Object.assign(
    accountForm,
    account
      ? {
          ...account,
          nativeAccountIds: account.nativeAccountIds ?? (account.nativeAccountId ? [account.nativeAccountId] : []),
        }
      : {
          id: '',
          name: '',
          currencyCode: 'USD',
          categoryId: data.value?.categories[0]?.id ?? 'spendable',
          included: true,
          balanceKind: 'asset',
          nativeAccountIds: [],
          preferredSource: 'manual',
        },
  );
  activePanel.value = 'accounts';
}
async function submitAccount() {
  await mutate(
    () =>
      saveFinanceAccount({
        ...(accountForm.id ? { id: accountForm.id } : {}),
        name: accountForm.name.trim(),
        currencyCode: accountForm.currencyCode.toUpperCase(),
        categoryId: accountForm.categoryId,
        included: accountForm.included,
        balanceKind: accountForm.balanceKind,
        nativeAccountIds: accountForm.nativeAccountIds,
        preferredSource: accountForm.preferredSource,
      }),
    'Account reporting settings saved.',
  );
  if (!error.value) activePanel.value = null;
}
async function submitSnapshot() {
  await mutate(
    () =>
      saveFinanceSnapshot({ ...snapshotForm, balance: Number(snapshotForm.balance), source: 'manual', verified: true }),
    'Verified valuation saved and charts refreshed. Earlier revisions remain in the audit history.',
  );
  if (!error.value) {
    snapshotForm.balance = '';
    activePanel.value = null;
  }
}
async function submitCashFlow() {
  await mutate(
    () =>
      flowCorrectionId.value
        ? correctFinancePrincipal({
            cashFlowId: flowCorrectionId.value,
            date: flowForm.date,
            amount: Number(flowForm.amount),
            description: flowForm.description,
            contributionKind: flowForm.contributionKind,
          })
        : saveFinanceCashFlow({
            ...flowForm,
            amount: Number(flowForm.amount),
            opening: ['contribution', 'adjustment'].includes(flowForm.type) && flowForm.opening,
            ...(flowForm.type === 'transfer' ? { toAccountId: flowForm.toAccountId } : { toAccountId: null }),
          }),
    flowCorrectionId.value
      ? 'Principal correction saved. The original record remains in the audit history.'
      : 'Cash flow recorded. Balances are changed only by dated valuations.',
  );
  if (!error.value) {
    flowForm.amount = '';
    flowForm.idempotencyKey = newFlowKey();
    flowCorrectionId.value = '';
    activePanel.value = null;
  }
}
function recordCashFlow(flow?: FinanceCashFlow) {
  flowCorrectionId.value = flow?.id ?? '';
  Object.assign(flowForm, {
    accountId: flow?.accountId ?? data.value?.accounts[0]?.id ?? '',
    date: flow?.date ?? today(),
    amount: flow ? String(flow.amount) : '',
    type: flow?.type ?? 'contribution',
    toAccountId: flow?.toAccountId ?? '',
    description: flow?.description ?? '',
    opening: flow?.opening ?? false,
    contributionKind: flow?.contributionKind ?? 'unspecified',
    idempotencyKey: newFlowKey(),
  });
  activePanel.value = 'cashflow';
}
function reviewPrincipalLedger() {
  if (!data.value?.cashFlows.length) {
    recordCashFlow();
    return;
  }
  ledgerOpen.value = true;
  void nextTick(() => ledgerElement.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
function recordBalance(accountId: string, date = today(), balance?: number | null) {
  Object.assign(snapshotForm, {
    accountId,
    date,
    balance: balance === null || balance === undefined ? '' : String(balance),
    description: '',
  });
  detailOpen.value = false;
  activePanel.value = 'snapshot';
  void nextTick(() => snapshotFormElement.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
async function selectFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  error.value = '';
  preview.value = null;
  previewPayload.value = null;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('Choose a history file smaller than 8 MB.');
    const parsed = parseHistoryFile(await file.text(), file.name);
    fileName.value = file.name;
    sourceId.value = parsed.sourceId;
    importRecords.value = parsed.records;
    skippedBlank.value = parsed.skippedBlank;
    Object.keys(importMapping).forEach((k) => delete importMapping[k]);
    importLabels.value.forEach((label) => {
      const record = parsed.records.find((r) => r.accountName === label)!;
      const match = data.value?.accounts.find(
        (a) => a.id === record.accountId || a.name.trim().toLowerCase() === label.trim().toLowerCase(),
      );
      if (match) importMapping[label] = match.id;
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'The file could not be read.';
  }
}
async function previewImport() {
  busy.value = true;
  error.value = '';
  preview.value = null;
  try {
    const payload = {
      ...mapHistoryRecords(sourceId.value, importRecords.value, importMapping),
      source: /\.csv$/i.test(fileName.value) ? ('csv' as const) : ('google-sheets' as const),
    };
    preview.value = await previewFinanceImport(payload);
    previewPayload.value = payload;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not preview history.';
  } finally {
    busy.value = false;
  }
}
async function commitImport() {
  if (!preview.value || !previewPayload.value) return;
  const payload = { ...previewPayload.value, previewToken: preview.value.previewToken };
  await mutate(
    () => commitFinanceImport(payload),
    'History imported. Reimporting the same records will not duplicate them.',
  );
  if (!error.value) {
    preview.value = null;
    importRecords.value = [];
    activePanel.value = null;
  }
}
function downloadTemplate() {
  const date = today().slice(0, 7) + '-01';
  const escape = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  const rows = included.value.map((account) =>
    [escape(account.name), date, '', account.currencyCode, account.id, 'personal-monthly-input-v1', 'true'].join(','),
  );
  const blob = new Blob(
    ['accountName,date,balance,currencyCode,accountId,sourceId,verified\n' + rows.join('\n') + '\n'],
    { type: 'text/csv' },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'balance-history-template.csv';
  link.click();
  URL.revokeObjectURL(url);
}
watch([period, granularity, sourceView, throughDate], reload);
watch(importMapping, () => {
  preview.value = null;
  previewPayload.value = null;
});
let refreshTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  if (typeof route.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.query.date) && !route.query.accountId)
    throughDate.value = route.query.date;
  void reload().then(() => {
    const requestedAccount = typeof route.query.accountId === 'string' ? route.query.accountId : '';
    const requestedDate =
      typeof route.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.query.date) ? route.query.date : today();
    if (data.value?.accounts.some((account) => account.id === requestedAccount))
      recordBalance(requestedAccount, requestedDate);
  });
  refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && !busy.value && !activePanel.value) void reload();
  }, 60000);
  void loadAccounts()
    .then((a) => (nativeAccounts.value = a))
    .catch(() => {
      /* Standalone manual reporting remains usable. */
    });
});
onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
const inputClass =
  'border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2';
</script>

<template>
  <PageWrapper class="space-y-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Personal net worth</h1>
        <p class="text-muted-foreground mt-1 text-sm">
          Your recorded account history, contributed principal and manual backup. Bank updates stay optional.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button as-child variant="outline" size="sm"
          ><RouterLink :to="{ name: ROUTES_NAMES.dashboard }">Bank dashboard</RouterLink></Button
        >
        <Button variant="outline" size="sm" :disabled="loading || busy" @click="reload"
          ><RefreshCwIcon class="size-4" />Refresh</Button
        >
        <Button variant="outline" size="sm" @click="activePanel = activePanel === 'import' ? null : 'import'"
          ><UploadIcon class="size-4" />Import history</Button
        >
        <Button size="sm" @click="activePanel = activePanel === 'snapshot' ? null : 'snapshot'"
          ><PlusIcon class="size-4" />Record balance</Button
        >
      </div>
    </div>
    <Callout v-if="error" variant="destructive" title="Couldn't complete this action" role="alert">{{ error }}</Callout>
    <Callout v-if="notice" variant="success" title="Saved" role="status">{{ notice }}</Callout>
    <div class="flex flex-wrap items-end gap-3">
      <label class="grid gap-1 text-sm"
        >Balance sources
        <select v-model="sourceView" :class="inputClass" aria-label="Balance sources">
          <option value="all">Automatic + personal records</option>
          <option value="personal">Personal records only</option>
        </select>
      </label>
      <label class="grid gap-1 text-sm"
        >Through date
        <input
          v-model="throughDate"
          :class="inputClass"
          type="date"
          :max="today()"
          aria-label="Balances through date"
        />
      </label>
      <Button v-if="throughDate" variant="ghost" size="sm" @click="throughDate = ''">Latest balances</Button>
      <p class="text-muted-foreground max-w-2xl text-xs">
        Before November 5, 2026, recorded Sheet history is primary. From that date, connected accounts can use automatic
        balances; dated manual corrections and fallback records remain available.
      </p>
    </div>
    <SheetsSyncPanel
      :accounts="data?.accounts ?? []"
      @updated="refreshBalances"
      @review-principal="reviewPrincipalLedger"
    />
    <PrincipalReviewPanel
      :accounts="data?.accounts ?? []"
      @updated="refreshBalances"
      @record="
        (accountId, date) => {
          recordCashFlow();
          flowForm.accountId = accountId;
          if (date) flowForm.date = date;
        }
      "
    />
    <div v-if="loading && !data" class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <div v-for="i in 4" :key="i" class="bg-muted h-28 animate-pulse rounded-lg" />
    </div>
    <template v-if="data">
      <Card
        as="button"
        type="button"
        class="focus-visible:ring-ring w-full cursor-pointer p-5 text-left focus-visible:ring-2 focus-visible:outline-none sm:p-6"
        aria-label="View total net worth balances and history"
        @click="openDetails('all')"
      >
        <div class="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p class="text-muted-foreground text-sm">
              Total net worth <span v-if="!data.complete" class="text-warning-text">· partial</span>
            </p>
            <p class="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              {{ money(data.asOf ? (data.total ?? data.knownTotal) : null) }}
            </p>
            <p v-if="!data.complete && data.asOf" class="text-warning-text mt-1 text-xs">
              Recorded subtotal · unavailable balances are excluded
            </p>
            <p class="text-muted-foreground mt-2 text-xs">
              {{ included.length }} included accounts · {{ data.snapshotCount }} preserved valuations
              <span v-if="data.asOf"> · last snapshot {{ data.asOf }}</span>
            </p>
          </div>
          <div class="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <p class="text-muted-foreground">Monthly change</p>
              <p class="mt-1 font-semibold">{{ money(changeAmount(data.monthlyChange)) }}</p>
              <p class="text-muted-foreground mt-1 text-xs">{{ pct(changePercent(data.monthlyChange)) }}</p>
            </div>
            <div>
              <p class="text-muted-foreground">Yearly change</p>
              <p class="mt-1 font-semibold">{{ money(changeAmount(data.yearlyChange)) }}</p>
              <p class="text-muted-foreground mt-1 text-xs">{{ pct(changePercent(data.yearlyChange)) }}</p>
            </div>
            <div>
              <p class="text-muted-foreground">Historical high</p>
              <p class="mt-1 font-semibold">{{ money(data.highest) }}</p>
            </div>
          </div>
        </div>
      </Card>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          v-for="category in data.categories"
          :key="category.id"
          as="button"
          type="button"
          class="hover:border-primary/50 focus-visible:ring-ring w-full cursor-pointer p-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
          :aria-label="`View ${category.name} balances and history`"
          @click="openDetails('category', category.id)"
        >
          <div class="text-muted-foreground flex items-center gap-2 text-sm">
            <span class="size-2.5 rounded-full" :style="{ backgroundColor: category.color }" />{{ category.name }}
          </div>
          <p class="mt-2 text-xl font-semibold">{{ money(categoryTotal(category.id)) }}</p>
          <p class="text-muted-foreground mt-1 text-xs">
            {{ included.filter((a) => a.categoryId === category.id).length }} included accounts
            <span v-if="categoryPartial(category.id)" class="text-warning-text"> · partial subtotal</span>
          </p>
          <p class="text-muted-foreground mt-2 text-xs">View balances & history →</p>
        </Card>
      </div>
      <Callout v-if="allMissing.length" variant="warning" title="Some balances are missing"
        >{{ allMissing.map((a) => a.name).join(', ') }}. Missing balances are never treated as zero.</Callout
      >
      <Card v-if="activePanel" class="p-4 sm:p-5">
        <div class="mb-5 flex items-center justify-between">
          <h2 class="font-semibold">
            {{
              {
                accounts: accountForm.id ? 'Edit reporting account' : 'Add reporting account',
                snapshot: 'Record a verified balance',
                cashflow: flowCorrectionId ? 'Correct a principal record' : 'Record principal or growth',
                import: 'Import historical balances',
                categories: 'Customize categories',
              }[activePanel]
            }}
          </h2>
          <Button variant="ghost" size="sm" @click="activePanel = null">Close</Button>
        </div>
        <form
          v-if="activePanel === 'accounts'"
          class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          @submit.prevent="submitAccount"
        >
          <label class="grid gap-1.5 text-sm"
            >Account name<input
              v-model="accountForm.name"
              :class="inputClass"
              required
              maxlength="200"
              placeholder="Capital One Safe Checking"
          /></label>
          <label class="grid gap-1.5 text-sm"
            >Reporting category<select v-model="accountForm.categoryId" :class="inputClass">
              <option v-for="category in data.categories" :key="category.id" :value="category.id">
                {{ category.name }}
              </option>
            </select></label
          >
          <label class="grid gap-1.5 text-sm"
            >Balance represents<select v-model="accountForm.balanceKind" :class="inputClass">
              <option value="asset">Asset</option>
              <option value="liability">Liability (amount owed)</option>
            </select></label
          >
          <label class="grid gap-1.5 text-sm"
            >Currency<input
              v-model="accountForm.currencyCode"
              :class="inputClass"
              pattern="[A-Za-z]{3}"
              maxlength="3"
              required
          /></label>
          <fieldset class="grid gap-1.5 text-sm">
            <legend class="mb-1.5">Linked MoneyMatter accounts</legend>
            <div class="max-h-44 space-y-2 overflow-y-auto rounded-md border p-3">
              <label v-for="account in nativeAccounts" :key="account.id" class="flex items-start gap-2">
                <input
                  v-model="accountForm.nativeAccountIds"
                  type="checkbox"
                  :value="account.id"
                  class="accent-primary mt-0.5 size-4 shrink-0"
                />
                <span>{{ account.name }}</span>
              </label>
              <p v-if="!nativeAccounts.length" class="text-muted-foreground text-xs">
                No existing MoneyMatter accounts.
              </p>
            </div>
            <p class="text-muted-foreground text-xs">
              Select every account included in this history row. Leave empty for manual history.
            </p>
          </fieldset>
          <label class="grid gap-1.5 text-sm"
            >Preferred source<select v-model="accountForm.preferredSource" :class="inputClass">
              <option value="manual">Manual verified balances</option>
              <option value="google-sheets">Google Sheets history</option>
              <option value="simplefin">SimpleFIN</option>
              <option value="plaid">Plaid (when connected)</option>
            </select></label
          >
          <label class="flex items-center gap-2 text-sm"
            ><input v-model="accountForm.included" type="checkbox" class="accent-primary size-4" />Include in personal
            net worth</label
          >
          <p class="text-muted-foreground text-xs sm:col-span-2">
            Category follows your choice, independent of the bank's account type. Linked balances are combined only when
            all selected accounts have a valuation on the same day. Each bank account can belong to one history row.
          </p>
          <div class="sm:col-span-2 lg:col-span-3">
            <Button type="submit" :disabled="busy">{{ busy ? 'Saving…' : 'Save account' }}</Button>
          </div>
        </form>
        <form
          v-else-if="activePanel === 'snapshot'"
          ref="snapshotFormElement"
          class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          @submit.prevent="submitSnapshot"
        >
          <label class="grid gap-1.5 text-sm"
            >Account<select v-model="snapshotForm.accountId" :class="inputClass" required>
              <option value="" disabled>Select account</option>
              <option v-for="account in data.accounts" :key="account.id" :value="account.id">{{ account.name }}</option>
            </select></label
          >
          <label class="grid gap-1.5 text-sm"
            >Actual valuation date<input
              v-model="snapshotForm.date"
              :class="inputClass"
              type="date"
              :max="today()"
              required
          /></label>
          <label class="grid gap-1.5 text-sm"
            >Balance<input
              v-model="snapshotForm.balance"
              :class="inputClass"
              type="number"
              step="0.01"
              required
              placeholder="0.00"
          /></label>
          <label class="grid gap-1.5 text-sm"
            >Description (optional)<input v-model="snapshotForm.description" :class="inputClass" maxlength="1000"
          /></label>
          <p class="text-muted-foreground text-xs sm:col-span-2 lg:col-span-4">
            Use the date the balance was valued. A correction adds a new revision; it preserves the previous record. A
            balance is not a contribution.
          </p>
          <div class="sm:col-span-2 lg:col-span-4">
            <Button type="submit" :disabled="busy || !data.accounts.length">Save verified balance</Button
            ><Button type="button" variant="link" @click="editAccount()">Add an account</Button>
          </div>
        </form>
        <form
          v-else-if="activePanel === 'cashflow'"
          class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          @submit.prevent="submitCashFlow"
        >
          <label class="grid gap-1.5 text-sm"
            >Account<select v-model="flowForm.accountId" :class="inputClass" :disabled="!!flowCorrectionId" required>
              <option value="" disabled>Select account</option>
              <option v-for="account in data.accounts" :key="account.id" :value="account.id">{{ account.name }}</option>
            </select></label
          >
          <label class="grid gap-1.5 text-sm"
            >Actual date<input v-model="flowForm.date" :class="inputClass" type="date" :max="today()" required
          /></label>
          <label class="grid gap-1.5 text-sm"
            >Type<select v-model="flowForm.type" :class="inputClass" :disabled="!!flowCorrectionId">
              <option value="contribution">External contribution / deposit</option>
              <option value="withdrawal">Withdrawal</option>
              <option value="transfer">Transfer between my accounts</option>
              <option value="adjustment">Principal adjustment</option>
              <option value="interest">Interest earned</option>
              <option value="dividend">Dividend / reinvested dividend</option>
            </select></label
          >
          <label class="grid gap-1.5 text-sm"
            >Amount<input
              v-model="flowForm.amount"
              :class="inputClass"
              type="number"
              step="0.01"
              :min="flowForm.type === 'adjustment' ? undefined : '0.01'"
              required
          /></label>
          <label v-if="flowForm.type === 'transfer'" class="grid gap-1.5 text-sm"
            >Destination account<select
              v-model="flowForm.toAccountId"
              :class="inputClass"
              :disabled="!!flowCorrectionId"
              required
            >
              <option value="" disabled>Select destination</option>
              <option
                v-for="account in data.accounts.filter((a) => a.id !== flowForm.accountId)"
                :key="account.id"
                :value="account.id"
              >
                {{ account.name }}
              </option>
            </select></label
          >
          <label class="grid gap-1.5 text-sm"
            >Description (optional)<input v-model="flowForm.description" :class="inputClass" maxlength="1000"
          /></label>
          <label v-if="flowForm.type === 'contribution'" class="grid gap-1.5 text-sm"
            >Contribution source
            <select v-model="flowForm.contributionKind" :class="inputClass">
              <option value="unspecified">Not separately identified</option>
              <option value="employee">Employee contribution</option>
              <option value="employer">Employer contribution / match</option>
            </select>
          </label>
          <label
            v-if="['adjustment', 'contribution'].includes(flowForm.type)"
            class="flex items-start gap-2 text-sm sm:col-span-2 lg:col-span-3"
            ><input
              v-model="flowForm.opening"
              type="checkbox"
              :disabled="!!flowCorrectionId"
              class="accent-primary mt-0.5 size-4 shrink-0"
            />This establishes my known opening principal. I have entered the complete contribution basis from this
            date.</label
          >
          <p class="text-muted-foreground text-xs sm:col-span-2 lg:col-span-3">
            Purchases and sales inside an investment account are not contributions. Dividends and interest are returns.
            Transfers move principal between accounts without creating outside contributions. Set a reliable opening
            basis before displaying investment gains.
          </p>
          <div class="sm:col-span-2 lg:col-span-3">
            <Button type="submit" :disabled="busy || !data.accounts.length">{{
              flowCorrectionId ? 'Save principal correction' : 'Save cash flow'
            }}</Button>
          </div>
        </form>
        <div v-else-if="activePanel === 'categories'" class="space-y-4">
          <div v-for="category in categoryDraft" :key="category.id" class="flex max-w-lg items-center gap-3">
            <input
              v-model="category.color"
              type="color"
              class="border-input size-10 rounded border"
              :aria-label="`${category.name} color`"
            /><input
              v-model="category.name"
              :class="inputClass"
              :aria-label="`${category.id} category name`"
              maxlength="100"
            /><Button
              v-if="!data.accounts.some((a) => a.categoryId === category.id)"
              variant="ghost"
              size="sm"
              @click="categoryDraft = categoryDraft.filter((c) => c.id !== category.id)"
              >Remove</Button
            >
          </div>
          <div>
            <Button variant="outline" size="sm" @click="addCategory">Add category</Button>
          </div>
          <Button
            :disabled="busy || categoryDraft.some((c) => !c.name.trim())"
            @click="mutate(() => saveFinanceCategories(categoryDraft), 'Category names and colors saved.')"
            >Save categories</Button
          >
        </div>
        <div v-else-if="activePanel === 'import'" class="space-y-5">
          <p class="text-muted-foreground text-sm">
            Upload a normalized Google Sheets history export or CSV. Each record needs account, actual date
            (YYYY-MM-DD), balance, and currencyCode. Historical names stay in the source record. Blank balances are
            skipped. Contributions are entered separately.
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".json,.csv,application/json,text/csv"
              class="file:bg-muted file:text-foreground file:mr-3 file:rounded file:border-0 file:px-3 file:py-2 file:text-sm"
              aria-label="Choose historical balance file"
              @change="selectFile"
            /><Button variant="outline" size="sm" @click="downloadTemplate"
              ><DownloadIcon class="size-4" />CSV template</Button
            >
          </div>
          <template v-if="importRecords.length">
            <p class="text-sm">
              {{ fileName }} · {{ importRecords.length }} nonblank values · {{ skippedBlank }} blanks skipped
            </p>
            <div class="grid gap-3 md:grid-cols-2">
              <label v-for="label in importLabels" :key="label" class="grid gap-1.5 text-sm"
                ><span>{{ label }} <span class="text-muted-foreground">→ current reporting account</span></span
                ><select v-model="importMapping[label]" :class="inputClass">
                  <option value="" disabled>Select an account</option>
                  <option value="__skip__">Skip this historical row</option>
                  <option v-for="account in data.accounts" :key="account.id" :value="account.id">
                    {{ account.name }}
                  </option>
                </select></label
              >
            </div>
            <Button :disabled="busy" variant="outline" @click="previewImport">{{
              busy ? 'Checking…' : 'Preview import'
            }}</Button>
          </template>
          <template v-if="preview">
            <Callout variant="info" title="Preview ready"
              >{{ preview.counts.insert }} new records · {{ preview.counts.duplicate }} duplicates skipped ·
              {{ preview.counts.protected }} verified records protected. Review the dates and mappings below before
              importing.</Callout
            >
            <Callout v-for="warning in preview.warnings" :key="warning" variant="warning" title="Review needed">{{
              warning
            }}</Callout>
            <div class="max-h-96 overflow-auto rounded-md border">
              <table class="w-full text-left text-xs">
                <thead class="bg-muted sticky top-0">
                  <tr>
                    <th class="p-3">Historical account</th>
                    <th class="p-3">Mapped account</th>
                    <th class="p-3">Recorded date</th>
                    <th class="p-3 text-right">Balance</th>
                    <th class="p-3">Action / formula</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="record in preview.records" :key="record.sourceKey" class="border-t">
                    <td class="p-3">{{ record.sourceLabel }}</td>
                    <td class="p-3">{{ accountById(record.accountId)?.name }}</td>
                    <td class="p-3 whitespace-nowrap">{{ record.date }}</td>
                    <td class="p-3 text-right whitespace-nowrap tabular-nums">
                      {{ money(record.balance, record.currencyCode) }}
                    </td>
                    <td class="max-w-sm p-3">
                      <span>{{ record.action }}</span
                      ><code v-if="record.formula" class="text-muted-foreground mt-1 block break-all">{{
                        record.formula
                      }}</code>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Button :disabled="busy || !preview.counts.insert" @click="commitImport"
              ><CheckIcon class="size-4" />Import {{ preview.counts.insert }} records</Button
            >
          </template>
        </div>
      </Card>
      <Card class="p-4 sm:p-5">
        <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <ChartLineIcon class="text-muted-foreground size-4" /><label class="sr-only" for="finance-chart"
              >Chart</label
            ><select id="finance-chart" v-model="chart" :class="[inputClass, 'w-auto']">
              <option v-for="option in chartOptions" :key="option[0]" :value="option[0]">
                {{ option[1] }}
              </option></select
            ><select
              v-if="accountIsRequired"
              v-model="selectedAccount"
              :class="[inputClass, 'max-w-64']"
              aria-label="Chart account"
            >
              <option v-for="account in data.accounts" :key="account.id" :value="account.id">{{ account.name }}</option>
            </select>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <div class="bg-muted flex flex-wrap rounded-md p-1">
              <button
                v-for="option in [
                  ['1', '1M'],
                  ['3', '3M'],
                  ['6', '6M'],
                  ['12', '1Y'],
                  ['60', '5Y'],
                  ['all', 'All'],
                ]"
                :key="option[0]"
                type="button"
                :class="[
                  'rounded px-2.5 py-1.5 text-xs',
                  period === option[0] ? 'bg-background shadow-sm' : 'text-muted-foreground',
                ]"
                :aria-pressed="period === option[0]"
                @click="period = option[0]!"
              >
                {{ option[1] }}
              </button>
            </div>
            <select v-model="granularity" :class="[inputClass, 'w-auto']" aria-label="Chart granularity">
              <option value="monthly">Monthly</option>
              <option value="daily">Daily</option>
            </select>
          </div>
        </div>
        <div :class="{ 'opacity-50': loading }">
          <p v-if="/^\d{4}-\d{2}/.test(chartModel.rows[0]?.label ?? '')" class="text-muted-foreground mb-3 text-xs">
            Recorded range: {{ chartModel.rows[0]?.label }} – {{ chartModel.rows.at(-1)?.label }} ·
            {{ chartModel.rows.length }} observations
          </p>
          <FinanceChart
            :rows="chartModel.rows"
            :series="chartModel.series"
            :mode="chartModel.mode"
            :percentage="chartModel.percentage"
            :currency="chartCurrency"
            @select="selectChartPoint"
          />
        </div>
        <p class="text-muted-foreground mt-4 text-xs">
          {{
            chart === 'principal' || chart === 'gains'
              ? 'Gain = current value − net contributed principal. This is a contribution-based gain, not annualized performance. No gain is shown without a known opening basis.'
              : chart === 'allocation'
                ? 'Allocation shows positive included asset balances. Liabilities remain included in total net worth.'
                : 'Every recorded date is shown, including partial subtotals (open dots and dashed lines). Missing accounts stay missing. Lines join recorded observations; no balances are inferred between them. Move across the chart or click a date for details.'
          }}
        </p>
      </Card>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-lg font-semibold">Accounts & contribution basis</h2>
        <div class="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" @click="activePanel = 'categories'"
            ><Settings2Icon class="size-4" />Categories</Button
          ><Button variant="outline" size="sm" @click="recordCashFlow()"
            ><ArrowDownUpIcon class="size-4" />Record cash flow</Button
          ><Button variant="outline" size="sm" @click="editAccount()"><PlusIcon class="size-4" />Add account</Button>
        </div>
      </div>
      <Card v-if="!data.accounts.length" class="p-10 text-center"
        ><WalletIcon class="text-muted-foreground mx-auto mb-3 size-8" />
        <h3 class="font-semibold">Build your personal view</h3>
        <p class="text-muted-foreground mx-auto mt-2 max-w-lg text-sm">
          Add a manual reporting account or link an existing MoneyMatter account. Choose its category and whether it
          belongs in your net worth, then record balances or import history.
        </p>
        <Button class="mt-5" @click="editAccount()">Add your first account</Button></Card
      >
      <Card v-else class="overflow-hidden"
        ><div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="bg-muted/50 text-muted-foreground text-xs">
              <tr>
                <th class="p-4">Account</th>
                <th class="p-4">Category</th>
                <th class="p-4 text-right">Balance</th>
                <th class="p-4">Valued / source</th>
                <th class="p-4 text-right">Net principal</th>
                <th class="p-4 text-right">Gain / growth</th>
                <th class="p-4" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="account in data.accounts"
                :key="account.id"
                :class="['border-t', !account.included && 'opacity-60']"
              >
                <td class="p-4">
                  <button
                    type="button"
                    class="cursor-pointer text-left font-medium whitespace-nowrap hover:underline focus-visible:underline"
                    :aria-label="`View ${account.name} balance history`"
                    @click="openDetails('account', account.id)"
                  >
                    {{ account.name }}
                  </button>
                  <p class="text-muted-foreground mt-1 text-xs">
                    {{ account.balanceKind === 'liability' ? 'Liability' : 'Asset' }} ·
                    {{ account.included ? 'Included' : 'Excluded from net worth' }}
                  </p>
                  <p class="text-muted-foreground mt-1 text-xs">{{ accountManagementLabel(account) }}</p>
                  <p v-if="account.nativeAccountIds?.length" class="text-muted-foreground mt-1 max-w-80 text-xs">
                    Linked:
                    <template v-for="(nativeId, index) in account.nativeAccountIds" :key="nativeId">
                      <span v-if="index">, </span>
                      <RouterLink
                        :to="{ name: ROUTES_NAMES.account, params: { id: nativeId } }"
                        class="hover:underline"
                        >{{ nativeAccounts.find((a) => a.id === nativeId)?.name ?? 'MoneyMatter account' }}</RouterLink
                      >
                    </template>
                  </p>
                </td>
                <td class="p-4 whitespace-nowrap">
                  <span class="inline-flex items-center gap-2"
                    ><span
                      class="size-2 rounded-full"
                      :style="{ backgroundColor: categoryById(account.categoryId)?.color }"
                    />{{ categoryById(account.categoryId)?.name }}</span
                  >
                </td>
                <td class="p-4 text-right font-medium whitespace-nowrap tabular-nums">
                  {{ money(account.latestBalance, account.currencyCode)
                  }}<span
                    v-if="account.latestBalance === null"
                    class="text-warning-text mt-1 block text-xs font-normal"
                    >{{ detailPoint?.inactiveAccountIds?.includes(account.id) ? 'Not opened yet' : 'Missing' }}</span
                  >
                </td>
                <td class="p-4 text-xs whitespace-nowrap">
                  <p>{{ account.valuationDate ?? 'No valuation yet' }}</p>
                  <p class="text-muted-foreground mt-1">
                    {{ valuationSourceLabel(account.valuationSource ?? account.preferredSource)
                    }}{{ account.verified ? ' · verified' : '' }}
                  </p>
                  <p
                    v-if="account.staleDays !== null && account.staleDays !== undefined && account.staleDays > 7"
                    class="text-warning-text mt-1"
                  >
                    {{ account.staleDays }} days old
                  </p>
                  <p v-if="account.connectionStatus === 'disconnected'" class="text-warning-text mt-1">
                    Connection disconnected
                  </p>
                  <p v-if="account.lastSuccessfulSyncAt" class="text-muted-foreground mt-1">
                    Last sync {{ account.lastSuccessfulSyncAt.slice(0, 10) }}
                  </p>
                </td>
                <td class="p-4 text-right whitespace-nowrap tabular-nums">
                  {{ money(account.principal, account.currencyCode)
                  }}<span v-if="account.principal === null" class="text-muted-foreground mt-1 block text-xs"
                    >{{
                      account.knownPrincipal !== null && account.knownPrincipal !== undefined
                        ? `${money(account.knownPrincipal, account.currencyCode)} recorded · later contributions need verification`
                        : 'Opening basis needed'
                    }}
                    <span v-if="account.principalValidThrough" class="mt-1 block"
                      >Verified through {{ account.principalValidThrough }}</span
                    > </span
                  ><span v-else class="text-muted-foreground mt-1 block text-xs"
                    >{{ money(account.contributions, account.currencyCode) }} in ·
                    {{ money(account.withdrawals, account.currencyCode) }} out</span
                  >
                  <span
                    v-if="account.employeeContributions || account.employerContributions"
                    class="text-muted-foreground mt-1 block text-xs"
                    >{{ money(account.employeeContributions ?? 0, account.currencyCode) }} employee ·
                    {{ money(account.employerContributions ?? 0, account.currencyCode) }} employer</span
                  >
                </td>
                <td class="p-4 text-right whitespace-nowrap tabular-nums">
                  <p
                    :class="
                      account.gain !== null && account.gain < 0 ? 'text-app-expense-color' : 'text-app-income-color'
                    "
                  >
                    {{ money(account.gain, account.currencyCode) }}
                  </p>
                  <p class="text-muted-foreground mt-1 text-xs">
                    {{ pct(account.gainPercent)
                    }}<span v-if="account.interest">
                      · {{ money(account.interest, account.currencyCode) }} interest</span
                    >
                  </p>
                  <p
                    v-if="
                      account.moneyWeightedReturnPercent !== null && account.moneyWeightedReturnPercent !== undefined
                    "
                    class="text-muted-foreground mt-1 text-xs"
                  >
                    {{ pct(account.moneyWeightedReturnPercent) }} annualized XIRR
                  </p>
                </td>
                <td class="p-3 whitespace-nowrap">
                  <Button variant="ghost" size="sm" @click="openDetails('account', account.id)">History</Button
                  ><Button
                    variant="ghost"
                    size="sm"
                    :aria-label="`Record ${account.name} balance`"
                    @click="recordBalance(account.id)"
                    >Record balance</Button
                  ><Button variant="ghost" size="sm" @click="editAccount(account)">Edit</Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div></Card
      >
      <details v-if="history.length" class="border-border rounded-lg border">
        <summary class="cursor-pointer p-4 text-sm font-medium">Recorded snapshots & completeness</summary>
        <div class="max-h-80 overflow-auto border-t">
          <table class="w-full text-left text-xs">
            <thead class="bg-muted">
              <tr>
                <th class="p-3">Recorded date</th>
                <th class="p-3 text-right">Net worth</th>
                <th class="p-3">Completeness</th>
                <th class="p-3">Missing balances</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="point in [...history].reverse()" :key="point.date" class="border-t">
                <td class="p-3">
                  <button
                    type="button"
                    class="cursor-pointer hover:underline"
                    @click="openDetails('all', '', point.date)"
                  >
                    {{ point.date }}
                  </button>
                </td>
                <td class="p-3 text-right tabular-nums">
                  {{ money(recordedNetWorth(point))
                  }}<span v-if="!point.complete" class="text-warning-text block">Recorded subtotal</span>
                </td>
                <td :class="['p-3', point.complete ? 'text-app-income-color' : 'text-warning-text']">
                  {{ point.complete ? 'Complete' : 'Partial' }}
                </td>
                <td class="p-3">
                  {{ point.missingAccountIds.map((id) => accountById(id)?.name ?? id).join(', ') || '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      <details
        v-if="data.cashFlows.length"
        id="contribution-ledger"
        ref="ledgerElement"
        :open="ledgerOpen"
        class="border-border rounded-lg border"
        @toggle="ledgerOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary class="cursor-pointer p-4 text-sm font-medium">Contribution & transfer ledger</summary>
        <div class="max-h-80 overflow-auto border-t">
          <table class="w-full text-left text-xs">
            <thead class="bg-muted">
              <tr>
                <th class="p-3">Date</th>
                <th class="p-3">Account / destination</th>
                <th class="p-3">Type</th>
                <th class="p-3 text-right">Amount</th>
                <th class="p-3">Source / verification</th>
                <th class="p-3">Description</th>
                <th class="p-3" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="flow in [...data.cashFlows].reverse()" :key="flow.id" class="border-t">
                <td class="p-3 whitespace-nowrap">{{ flow.date }}</td>
                <td class="p-3">
                  {{ accountById(flow.accountId)?.name
                  }}<span v-if="flow.toAccountId"> → {{ accountById(flow.toAccountId)?.name }}</span>
                </td>
                <td class="p-3">
                  {{ flow.type }}{{ flow.opening ? ' · opening basis' : '' }}
                  <span
                    v-if="flow.contributionKind && flow.contributionKind !== 'unspecified'"
                    class="text-muted-foreground mt-1 block"
                    >{{ flow.contributionKind === 'employer' ? 'Employer / match' : 'Employee' }}</span
                  >
                </td>
                <td class="p-3 text-right whitespace-nowrap tabular-nums">
                  {{ money(flow.amount, accountById(flow.accountId)?.currencyCode) }}
                </td>
                <td class="p-3">
                  {{ valuationSourceLabel(flow.source ?? 'manual') }}
                  <span class="text-muted-foreground mt-1 block">{{
                    flow.verified === false ? 'Needs verification' : 'Verified record'
                  }}</span>
                </td>
                <td class="p-3">{{ flow.description }}</td>
                <td class="p-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    :aria-label="`Correct principal record ${flow.date}`"
                    @click="recordCashFlow(flow)"
                    >Correct</Button
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      <div class="text-muted-foreground flex flex-wrap gap-x-5 gap-y-2 text-xs">
        <RouterLink
          :to="{ name: ROUTES_NAMES.analyticsCashFlow }"
          class="hover:text-foreground underline underline-offset-4"
          >Spending reports</RouterLink
        ><RouterLink
          :to="{ name: ROUTES_NAMES.optimizationsTransfers }"
          class="hover:text-foreground underline underline-offset-4"
          >Review & match transfers</RouterLink
        ><RouterLink :to="{ name: ROUTES_NAMES.accounts }" class="hover:text-foreground underline underline-offset-4"
          >Bank connections & accounts</RouterLink
        ><RouterLink
          :to="{ name: ROUTES_NAMES.analyticsInvestmentContributions }"
          class="hover:text-foreground underline underline-offset-4"
          >Portfolio contributions & returns</RouterLink
        >
        <a
          href="https://github.com/RaydenDodd/personal-finance-dashboard"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-foreground underline underline-offset-4"
          >MoneyMatter fork source · AGPL-3.0</a
        >
      </div>
    </template>
    <Dialog v-model:open="detailOpen">
      <DialogScrollContent class="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{{ detailTitle }}</DialogTitle>
          <DialogDescription
            >Recorded balances and their actual valuation dates. Blank entries remain missing; partial totals include
            only available balances.</DialogDescription
          >
        </DialogHeader>
        <template v-if="data">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <Button
              v-if="detailScope === 'account'"
              variant="outline"
              size="sm"
              @click="openDetails('category', detailAccounts[0]?.categoryId ?? '')"
              >Back to category</Button
            >
            <Button
              v-if="detailScope === 'account' && detailAccounts[0]"
              variant="outline"
              size="sm"
              @click="
                recordBalance(
                  detailAccounts[0].id,
                  detailPoint?.date ?? today(),
                  detailPoint?.balances[detailAccounts[0].id],
                )
              "
              >Correct selected balance</Button
            >
            <label class="grid gap-1 text-sm"
              >Snapshot date<select
                :value="detailPoint?.date"
                :class="inputClass"
                aria-label="Detail snapshot date"
                @change="detailDate = ($event.target as HTMLSelectElement).value"
              >
                <option v-for="point in [...detailPoints].reverse()" :key="point.date" :value="point.date">
                  {{ point.date }}{{ point.complete ? '' : ' · partial' }}
                </option>
              </select></label
            >
            <div class="text-right">
              <p class="text-2xl font-semibold">
                {{
                  money(
                    detailPoint && detailAccounts.some((a) => typeof detailPoint!.balances[a.id] === 'number')
                      ? recordedNetWorth(detailPoint)
                      : null,
                    detailCurrency,
                  )
                }}
              </p>
              <p class="text-muted-foreground text-xs">
                {{ detailPoint?.date ?? 'No recorded valuations'
                }}{{ detailPoint && !detailPoint.complete ? ' · recorded subtotal' : '' }}
              </p>
            </div>
          </div>
          <FinanceChart
            :rows="detailChartRows"
            :series="[
              {
                id: 'balance',
                name: detailScope === 'account' ? 'Account balance' : 'Recorded balances',
                color: 'var(--primary)',
              },
            ]"
            :currency="detailCurrency"
            @select="(row) => (detailDate = row.label)"
          />
          <div class="overflow-x-auto rounded-md border">
            <table class="w-full text-left text-sm" aria-label="Snapshot account balances">
              <thead class="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th class="p-3">Account</th>
                  <th class="p-3 text-right">Balance</th>
                  <th class="p-3">Valuation date</th>
                  <th class="p-3">Source</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="account in detailAccounts" :key="account.id" class="border-t">
                  <td class="p-3">
                    <button
                      type="button"
                      class="cursor-pointer text-left font-medium hover:underline"
                      :aria-label="`View ${account.name} history from details`"
                      @click="openDetails('account', account.id)"
                    >
                      {{ account.name }}
                    </button>
                    <p class="text-muted-foreground text-xs">
                      {{ account.balanceKind === 'liability' ? 'Liability' : 'Asset'
                      }}{{ account.included ? '' : ' · excluded from net worth' }}
                    </p>
                  </td>
                  <td class="p-3 text-right whitespace-nowrap tabular-nums">
                    {{ money(detailPoint?.balances[account.id], account.currencyCode)
                    }}<span
                      v-if="
                        detailPoint?.balances[account.id] === null || detailPoint?.balances[account.id] === undefined
                      "
                      :class="[
                        'block text-xs',
                        detailPoint?.inactiveAccountIds?.includes(account.id)
                          ? 'text-muted-foreground'
                          : 'text-warning-text',
                      ]"
                      >{{ detailPoint?.inactiveAccountIds?.includes(account.id) ? 'Not opened yet' : 'Missing' }}</span
                    >
                  </td>
                  <td class="p-3 whitespace-nowrap">
                    {{
                      detailPoint?.valuationDates?.[account.id] ??
                      (typeof detailPoint?.balances[account.id] === 'number' ? detailPoint.date : '—')
                    }}
                  </td>
                  <td class="text-muted-foreground p-3 text-xs">
                    {{
                      valuationSourceLabel(
                        (data.snapshots ?? []).find(
                          (s) =>
                            s.accountId === account.id &&
                            s.date === (detailPoint?.valuationDates?.[account.id] ?? detailPoint?.date),
                        )?.source,
                      )
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="max-h-72 overflow-auto rounded-md border">
            <table class="w-full text-left text-xs" aria-label="Detail balance history">
              <thead class="bg-muted/50 text-muted-foreground sticky top-0">
                <tr>
                  <th class="p-3">Recorded date</th>
                  <th class="p-3 text-right">{{ detailScope === 'account' ? 'Balance' : 'Recorded total' }}</th>
                  <th class="p-3">Completeness</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="point in [...detailPoints].reverse()" :key="point.date" class="border-t">
                  <td class="p-3">
                    <button
                      type="button"
                      class="cursor-pointer hover:underline"
                      :aria-label="`View snapshot ${point.date}`"
                      @click="detailDate = point.date"
                    >
                      {{ point.date }}
                    </button>
                  </td>
                  <td class="p-3 text-right tabular-nums">
                    {{
                      money(
                        detailAccounts.some((a) => typeof point.balances[a.id] === 'number')
                          ? recordedNetWorth(point)
                          : null,
                        detailCurrency,
                      )
                    }}
                  </td>
                  <td class="p-3" :class="point.complete ? 'text-app-income-color' : 'text-warning-text'">
                    {{ point.complete ? 'Complete' : `Partial · ${point.missingAccountIds.length} missing` }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </DialogScrollContent>
    </Dialog>
  </PageWrapper>
</template>
