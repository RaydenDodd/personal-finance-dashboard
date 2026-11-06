<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import {
  checkingForegroundSession,
  connectionIssue,
  markConnectionUnavailable,
  retryConnection,
} from '@/lib/connection-status';
import { LockKeyholeIcon, WifiOffIcon } from '@lucide/vue';
import { onBeforeUnmount, onMounted } from 'vue';

const offline = () => markConnectionUnavailable('offline');
onMounted(() => window.addEventListener('offline', offline));
onBeforeUnmount(() => window.removeEventListener('offline', offline));
</script>

<template>
  <div
    v-if="connectionIssue || checkingForegroundSession"
    role="alert"
    aria-live="assertive"
    class="bg-background fixed inset-0 z-[200] flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center"
    data-testid="connection-status-overlay"
  >
    <component
      :is="!connectionIssue || connectionIssue === 'authentication' ? LockKeyholeIcon : WifiOffIcon"
      class="text-primary-text size-9"
      aria-hidden="true"
    />
    <h1 class="text-xl font-semibold">
      {{
        !connectionIssue
          ? 'Checking secure session'
          : connectionIssue === 'authentication'
            ? 'Sign in securely'
            : 'Connection required'
      }}
    </h1>
    <p class="text-muted-foreground max-w-sm text-sm">
      {{
        !connectionIssue
          ? 'Confirming your connection and access before showing your finances.'
          : connectionIssue === 'authentication'
            ? 'Your secure session has expired. Returning to authentication…'
            : 'My Finances needs a live connection to your server. Saved balances are hidden until fresh data is available.'
      }}
    </p>
    <Button v-if="connectionIssue && connectionIssue !== 'authentication'" class="min-h-11" @click="retryConnection"
      >Try again</Button
    >
  </div>
</template>
