<template>
  <SettingRow
    :label="$t('settings.general.manualTransferMatching.label')"
    :description="$t('settings.general.manualTransferMatching.description')"
    docs-path="/settings/general-settings/#match-transfers-with-manual-accounts"
  >
    <Switch
      :model-value="matchTransfersWithManualAccounts"
      :disabled="isUpdating"
      @update:model-value="handleManualTransferMatchingToggle"
    />
  </SettingRow>

  <Separator />

  <SettingRow
    :label="$t('settings.general.pendingBankTransactions.label')"
    :description="
      $t(
        config.isSelfHost
          ? 'settings.general.pendingBankTransactions.descriptionSelfHost'
          : 'settings.general.pendingBankTransactions.description',
      )
    "
  >
    <Switch
      :model-value="importPendingBankTransactions"
      :disabled="isUpdating"
      @update:model-value="handlePendingBankTransactionsToggle"
    />
  </SettingRow>

  <Separator />

  <SettingRow
    label-id="bank-sync-schedule-label"
    :label="$t('settings.general.bankSyncSchedule.label')"
    :description="$t('settings.general.bankSyncSchedule.description')"
  >
    <div class="grid max-w-full shrink-0 grid-cols-2 gap-2" role="group" aria-labelledby="bank-sync-schedule-label">
      <SelectField
        v-for="(hour, index) in bankSyncHoursUtc"
        :key="index"
        :model-value="SYNC_HOUR_OPTIONS.find((option) => option.value === hour) ?? null"
        :values="SYNC_HOUR_OPTIONS"
        :placeholder="$t('settings.general.bankSyncSchedule.placeholder')"
        :disabled="isPatching || !userSettings"
        @update:model-value="(item) => handleBankSyncHourChange({ index, hour: item?.value })"
      />
    </div>
  </SettingRow>
</template>

<script setup lang="ts">
import { config } from '@/common/config';
import SelectField from '@/components/fields/select-field.vue';
import { Separator } from '@/components/lib/ui/separator';
import { Switch } from '@/components/lib/ui/switch';
import { useNotificationCenter } from '@/components/notification-center';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { DEFAULT_BANK_SYNC_HOURS_UTC } from '@bt/shared/types';
import { format, parseISO } from 'date-fns';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import SettingRow from './setting-row.vue';

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { data: userSettings, mutateAsync, isUpdating, patchAsync, isPatching } = useUserSettings();

const matchTransfersWithManualAccounts = computed(() => userSettings.value?.matchTransfersWithManualAccounts ?? false);
const importPendingBankTransactions = computed(() => userSettings.value?.importPendingBankTransactions ?? false);
// Values are UTC hours labelled in local time, so half-hour timezones need no conversion.
const TODAY = format(new Date(), 'yyyy-MM-dd');
const SYNC_HOUR_OPTIONS = Array.from({ length: 24 }, (_, value) => ({
  value,
  label: format(parseISO(`${TODAY}T${String(value).padStart(2, '0')}:00:00Z`), 'HH:mm'),
})).sort((a, b) => a.label.localeCompare(b.label));
const bankSyncHoursUtc = computed(() => userSettings.value?.bankSyncHoursUtc ?? DEFAULT_BANK_SYNC_HOURS_UTC);

const handleManualTransferMatchingToggle = async (value: boolean) => {
  try {
    await mutateAsync({
      ...userSettings.value,
      matchTransfersWithManualAccounts: value,
    });

    addSuccessNotification(t('settings.general.manualTransferMatching.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.manualTransferMatching.errorNotification'));
  }
};

const handlePendingBankTransactionsToggle = async (value: boolean) => {
  try {
    await mutateAsync({
      ...userSettings.value,
      importPendingBankTransactions: value,
    });

    addSuccessNotification(t('settings.general.pendingBankTransactions.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.pendingBankTransactions.errorNotification'));
  }
};

const handleBankSyncHourChange = async ({ index, hour }: { index: number; hour?: number }) => {
  if (hour === undefined) return;
  try {
    await patchAsync({ bankSyncHoursUtc: bankSyncHoursUtc.value.map((current, i) => (i === index ? hour : current)) });
    addSuccessNotification(t('settings.general.bankSyncSchedule.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.bankSyncSchedule.errorNotification'));
  }
};
</script>
