<script setup lang="ts">
import type { FinanceAccount } from '@/api/personal-finance';
import {
  getSheetsSyncStatus,
  resolveSheetsSyncConflict,
  runSheetsSync,
  saveSheetsServiceAccount,
  saveSheetsSyncConfig,
  startSheetsOAuth,
  type SheetsSyncStatus,
} from '@/api/sheets-sync';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Card } from '@/components/lib/ui/card';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(defineProps<{ accounts?: FinanceAccount[] }>(), { accounts: () => [] });
const emit = defineEmits<{ updated: []; reviewPrincipal: [] }>();
const status = ref<SheetsSyncStatus | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const enabled = ref(false);
const mirror = ref(false);
const settingsDirty = ref(false);
const summary = computed(() =>
  !status.value?.credentialsConfigured
    ? 'Connection required'
    : status.value.config?.enabled
      ? 'Automatic sync enabled'
      : 'Automatic sync paused',
);
const sourceError = computed(() => {
  const code = status.value?.lastErrorCode;
  if (!code || code === 'credentials_missing') return '';
  return (
    (
      {
        permission_denied: 'Google access was denied. Check that the connected account can edit this Sheet.',
        sheet_permission_denied: 'Google access was denied. Check that the connected account can edit this Sheet.',
        google_authorization_failed:
          'Google access has expired or is unavailable. Connect again to resume synchronization.',
        sheet_mapping_changed:
          'Sheet account labels or layout changed. Review the mappings before synchronization resumes.',
        duplicate_date_columns:
          'The Sheet contains duplicate date columns. Resolve them before synchronization resumes.',
        invalid_grant: 'Google access has expired. Connect again to resume synchronization.',
        sheet_structure_changed: 'The Sheet layout has changed. Review its account mappings before syncing.',
      } as Record<string, string>
    )[code] ?? 'Synchronization needs attention. Your saved records are still available.'
  );
});
const dateTime = (value: string | null) => (value ? new Date(value).toLocaleString() : 'Not yet');
const money = (value: number | null) =>
  value === null
    ? 'Unavailable'
    : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);
async function refresh() {
  try {
    status.value = await getSheetsSyncStatus();
    if (!settingsDirty.value) {
      enabled.value = status.value.config?.enabled ?? false;
      mirror.value = status.value.config?.mirrorSimplefin ?? false;
    }
  } catch {
    if (loading.value) error.value = 'Google Sheets status could not be loaded. Manual balances remain available.';
  } finally {
    loading.value = false;
  }
}
async function act(action: () => Promise<unknown>, message: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await action();
    notice.value = message;
    await refresh();
    emit('updated');
  } catch {
    error.value = 'The synchronization action could not be completed. Existing records have been preserved.';
  } finally {
    busy.value = false;
  }
}
async function saveSettings() {
  if (!status.value?.config) return;
  await act(async () => {
    await saveSheetsSyncConfig({ ...status.value!.config!, enabled: enabled.value, mirrorSimplefin: mirror.value });
    settingsDirty.value = false;
  }, 'Synchronization preferences saved.');
}
async function synchronize() {
  await act(async () => {
    const result = await runSheetsSync();
    if (result.skipped || result.failed)
      throw new Error(
        result.reason === 'credentials_missing'
          ? 'Connect Google Sheets before automatic synchronization can run.'
          : 'Synchronization could not complete; your saved records remain available.',
      );
  }, 'Synchronization completed. Review any conflicts below; both versions are retained until resolved.');
}
async function connectGoogle() {
  await act(async () => {
    const { authorizationUrl } = await startSheetsOAuth();
    const url = new URL(authorizationUrl);
    if (url.origin !== 'https://accounts.google.com') throw new Error('Unexpected authorization destination');
    window.location.assign(url.href);
  }, 'Opening Google sign-in…');
}
async function uploadCredential(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await act(async () => {
    if (file.size > 64 * 1024) throw new Error('Credential file is too large');
    const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
    if (
      parsed.type !== 'service_account' ||
      typeof parsed.client_email !== 'string' ||
      typeof parsed.private_key !== 'string'
    )
      throw new Error('Use a service account key');
    await saveSheetsServiceAccount({ clientEmail: parsed.client_email, privateKey: parsed.private_key });
  }, 'Google access saved. The service account must have editor access to this Sheet before synchronization can run.');
  input.value = '';
}
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void refresh();
  timer = setInterval(() => {
    if (!busy.value && document.visibilityState === 'visible') void refresh();
  }, 30000);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <Card class="p-4 sm:p-5">
    <details>
      <summary class="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm font-medium">
        <span>Google Sheets synchronization</span
        ><span class="text-muted-foreground text-xs">{{ loading ? 'Loading…' : summary }}</span>
      </summary>
      <div class="mt-4 space-y-4">
        <p class="text-muted-foreground text-sm">
          Keep dated balances and verified contributions in sync with your existing Sheet. Manual account updates work
          even when Google Sheets or a bank connection is unavailable.
        </p>
        <Callout v-if="error" variant="destructive" title="Could not complete synchronization" role="alert">{{
          error
        }}</Callout>
        <Callout v-if="notice" variant="success" title="Google Sheets" role="status">{{ notice }}</Callout>
        <template v-if="status">
          <Callout v-if="!status.credentialsConfigured" variant="info" title="Connect Google Sheets"
            >Automatic synchronization needs Google access on this server. Your saved history and manual updates remain
            available.</Callout
          >
          <Callout v-if="sourceError" variant="warning" title="Synchronization needs attention">{{
            sourceError
          }}</Callout>
          <div class="flex flex-wrap items-center gap-3">
            <Button v-if="status.oauthConfigured" variant="outline" size="sm" :disabled="busy" @click="connectGoogle"
              >Connect Google</Button
            >
            <label class="text-sm"
              >Service-account key
              <input
                type="file"
                accept=".json,application/json"
                aria-label="Google Sheets service account key"
                :disabled="busy"
                class="file:bg-muted file:text-foreground ml-2 max-w-full text-xs file:mr-2 file:rounded file:border-0 file:px-3 file:py-2"
                @change="uploadCredential"
              />
            </label>
          </div>
          <template v-if="status.config">
            <p class="text-sm">
              <a
                :href="`https://docs.google.com/spreadsheets/d/${encodeURIComponent(status.config.spreadsheetId)}/edit#gid=${status.config.sheetId}`"
                target="_blank"
                rel="noopener noreferrer"
                class="hover:text-primary underline underline-offset-4"
                >{{ status.config.sheetName }}</a
              ><span class="text-muted-foreground"> · {{ status.config.mappings.length }} mapped accounts</span>
            </p>
            <form class="space-y-3" @submit.prevent="saveSettings">
              <label class="flex items-start gap-2 text-sm"
                ><input
                  v-model="enabled"
                  type="checkbox"
                  class="accent-primary mt-0.5 size-4 shrink-0"
                  @change="settingsDirty = true"
                />Automatically synchronize Sheet edits and personal balance / principal entries</label
              >
              <label class="flex items-start gap-2 text-sm"
                ><input
                  v-model="mirror"
                  type="checkbox"
                  class="accent-primary mt-0.5 size-4 shrink-0"
                  @change="settingsDirty = true"
                />Also mirror verified SimpleFIN balances into Google Sheets</label
              >
              <div class="flex flex-wrap gap-2">
                <Button type="submit" variant="outline" size="sm" :disabled="busy">Save sync preferences</Button
                ><Button
                  type="button"
                  size="sm"
                  :disabled="busy || !status.credentialsConfigured"
                  @click="synchronize"
                  >{{ busy ? 'Working…' : 'Sync now' }}</Button
                >
              </div>
            </form>
          </template>
          <p v-else class="text-muted-foreground text-sm">
            Sheet account mappings need to be configured before automatic synchronization can start.
          </p>
          <dl class="text-muted-foreground grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
            <div>
              <dt>Last successful sync</dt>
              <dd class="text-foreground mt-1">{{ dateTime(status.lastSuccessAt) }}</dd>
            </div>
            <div>
              <dt>Last attempt</dt>
              <dd class="text-foreground mt-1">{{ dateTime(status.lastAttemptAt) }}</dd>
            </div>
            <div>
              <dt>Queued changes</dt>
              <dd class="text-foreground mt-1">{{ status.pendingWrites }}</dd>
            </div>
          </dl>
          <details v-if="status.issues?.length" class="rounded-md border p-3 text-xs">
            <summary class="cursor-pointer">New reconciliation details · {{ status.issues.length }}</summary>
            <div class="mt-3 max-h-48 overflow-auto">
              <p v-for="(issue, index) in status.issues" :key="index">
                {{ props.accounts.find((account) => account.id === issue.accountId)?.name ?? 'Account'
                }}{{ issue.cell ? ` · ${issue.cell}` : '' }}: {{ issue.reason }}
              </p>
            </div>
          </details>
          <div v-if="status.conflicts.length" class="space-y-3 border-t pt-4">
            <h3 class="text-sm font-medium">Review conflicting edits</h3>
            <p class="text-muted-foreground text-xs">
              Choose the verified value for each date. Both original records stay in the history.
            </p>
            <div
              v-for="conflict in status.conflicts"
              :key="conflict.id"
              class="space-y-2 rounded-md border p-3 text-sm"
            >
              <p class="font-medium">
                {{ props.accounts.find((account) => account.id === conflict.accountId)?.name ?? 'Account' }} ·
                {{ conflict.date }} · {{ conflict.kind }}
              </p>
              <p class="text-muted-foreground text-xs">
                Sheet: {{ money(conflict.sheetValue) }} · Dashboard: {{ money(conflict.dashboardValue) }}
              </p>
              <template v-if="conflict.kind === 'principal'"
                ><p class="text-muted-foreground text-xs">
                  Verify the contribution evidence and correct its ledger entry. A bank transaction is kept intact.
                </p>
                <Button variant="outline" size="sm" @click="emit('reviewPrincipal')"
                  >Review contribution ledger</Button
                ></template
              >
              <template v-else
                ><p v-if="conflict.reason === 'sheet_formula_protected'" class="text-muted-foreground text-xs">
                  This Sheet cell contains a formula. It will not be replaced by a dashboard value.
                </p>
                <div class="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="busy"
                    @click="
                      act(
                        () => resolveSheetsSyncConflict(conflict.id, 'sheet'),
                        'Sheet value selected. Charts will refresh.',
                      )
                    "
                    >Use Sheet value</Button
                  ><Button
                    variant="outline"
                    size="sm"
                    :disabled="busy || conflict.reason === 'sheet_formula_protected'"
                    @click="
                      act(
                        () => resolveSheetsSyncConflict(conflict.id, 'dashboard'),
                        'Dashboard value selected. Charts will refresh.',
                      )
                    "
                    >Use dashboard value</Button
                  >
                </div></template
              >
            </div>
          </div>
        </template>
      </div>
    </details>
  </Card>
</template>
