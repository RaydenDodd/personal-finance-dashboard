import { config } from '@/common/config';
import { clearPersistedQueries } from '@/lib/query-persister';

/** Home Screen installation uses the manifest; live finance never needs an offline cache. */
export async function preparePrivateClientStorage(): Promise<void> {
  if (!config.isSelfHost) return;
  const cleanup: Promise<unknown>[] = [clearPersistedQueries()];
  if ('serviceWorker' in navigator) {
    cleanup.push(
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(
            registrations
              .filter((registration) => new URL(registration.scope).pathname === '/')
              .map((registration) => registration.unregister()),
          ),
        ),
    );
  }
  if ('caches' in window) {
    cleanup.push(window.caches.keys().then((keys) => Promise.all(keys.map((key) => window.caches.delete(key)))));
  }
  // Restricted/private browser storage may refuse cleanup. Nothing reads or
  // writes that legacy store in self-host mode, even when its removal fails.
  await Promise.allSettled(cleanup);
}
