import { afterEach, describe, expect, it, vi } from 'vitest';
const { clear } = vi.hoisted(() => ({ clear: vi.fn().mockResolvedValue(undefined) }));
vi.mock('idb-keyval', () => ({
  createStore: () => ({}),
  clear,
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  entries: vi.fn(),
}));

describe('private finance response storage', () => {
  afterEach(() => {
    delete window.__APP_CONFIG__;
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  it('does not create response persisters even when IndexedDB is available, but can erase legacy data', async () => {
    vi.stubGlobal('indexedDB', {});
    window.__APP_CONFIG__ = { IS_SELF_HOST: 'true' };
    const storage = await import('./query-persister');
    expect(storage.persistedQueryFn).toBeUndefined();
    expect(storage.persistedImmutableQueryFn).toBeUndefined();
    await expect(storage.clearPersistedQueries()).resolves.toBe(true);
    expect(clear).toHaveBeenCalled();
  });
});
