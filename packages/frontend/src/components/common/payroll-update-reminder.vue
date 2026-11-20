<script setup lang="ts">
import { api } from '@/api/_api';
import { getPayroll } from '@/api/payroll';
import { Button } from '@/components/lib/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/lib/ui/dialog';
import { useAuthStore, useRootStore, useUserStore } from '@/stores';
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
const auth = useAuthStore(),
  root = useRootStore(),
  user = useUserStore(),
  router = useRouter();
const open = ref(false),
  busy = ref(false),
  error = ref('');
const checked = new Set<number>();
watch(
  () => [auth.isLoggedIn, root.isAppInitialized, user.user?.id] as const,
  async ([loggedIn, initialized, id]) => {
    if (!loggedIn || !initialized || id == null || checked.has(id)) return;
    checked.add(id);
    try {
      const data = await getPayroll();
      if (auth.isLoggedIn && user.user?.id === id && data.status.reminderDue) open.value = true;
    } catch {
      /* A reminder must not block app startup or imply a successful sync. */
    }
  },
  { immediate: true },
);
async function later(action: 'snooze' | 'dismiss') {
  busy.value = true;
  error.value = '';
  try {
    await api.post('/personal-finance/income/payroll/reminder', { action });
    open.value = false;
  } catch {
    error.value = 'The reminder preference could not be saved. Please try again.';
  } finally {
    busy.value = false;
  }
}
async function sync() {
  open.value = false;
  await router.push('/finances/income/actual?manage=sync');
}
</script>
<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader
        ><DialogTitle>Update your payroll?</DialogTitle
        ><DialogDescription
          >Your payroll update interval has passed. You can export your latest statements from your own ADP session and
          import them here. Nothing syncs in the background.</DialogDescription
        ></DialogHeader
      >
      <p v-if="error" class="text-destructive-text text-sm">{{ error }}</p>
      <DialogFooter class="flex-wrap gap-2">
        <Button variant="ghost" :disabled="busy" @click="later('dismiss')">Dismiss</Button>
        <Button variant="outline" :disabled="busy" @click="later('snooze')">Remind me later</Button>
        <Button :disabled="busy" @click="sync">Sync now</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
