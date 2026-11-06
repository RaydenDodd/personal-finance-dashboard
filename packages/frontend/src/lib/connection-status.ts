import { config } from '@/common/config';
import { computed, readonly, ref } from 'vue';

type ConnectionIssue = 'offline' | 'server' | 'authentication' | null;
const issue = ref<ConnectionIssue>(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : null);
export const connectionIssue = readonly(issue);
export const isConnectionBlocked = computed(() => issue.value !== null);
const foregroundCheck = ref(false);
export const checkingForegroundSession = readonly(foregroundCheck);
export const setForegroundSessionChecking = (checking: boolean) => {
  foregroundCheck.value = checking;
};

export const markConnectionUnavailable = (reason: Exclude<ConnectionIssue, null>) => {
  if (config.isSelfHost) issue.value = reason;
};

/** A reload fetches a new authorized page and fresh data; no stale retry view is restored. */
export const retryConnection = () => window.location.reload();
