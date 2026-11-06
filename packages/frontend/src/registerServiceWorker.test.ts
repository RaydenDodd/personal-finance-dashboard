import { afterEach, describe, expect, it, vi } from 'vitest';
const { clear } = vi.hoisted(() => ({ clear: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/query-persister', () => ({ clearPersistedQueries: clear }));

describe('retiring private offline storage', () => {
  afterEach(() => {
    delete window.__APP_CONFIG__;
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('erases legacy cached responses and root app workers while leaving a separately scoped portal worker alone', async () => {
    window.__APP_CONFIG__ = { IS_SELF_HOST: 'true' };
    const unregister = vi.fn().mockResolvedValue(true),
      portalUnregister = vi.fn(),
      remove = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistrations: vi.fn().mockResolvedValue([
          { scope: 'https://raydenfinance.duckdns.org/', unregister },
          { scope: 'https://raydenfinance.duckdns.org/authelia/', unregister: portalUnregister },
        ]),
      },
    });
    vi.stubGlobal('caches', { keys: vi.fn().mockResolvedValue(['legacy-app-cache']), delete: remove });
    const { preparePrivateClientStorage } = await import('./registerServiceWorker');
    await preparePrivateClientStorage();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(portalUnregister).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('legacy-app-cache');
  });

  it('does not block live finance if browser storage cleanup is denied', async () => {
    window.__APP_CONFIG__ = { IS_SELF_HOST: 'true' };
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: vi.fn().mockRejectedValue(new Error('denied')) } });
    vi.stubGlobal('caches', { keys: vi.fn().mockRejectedValue(new Error('denied')) });
    const { preparePrivateClientStorage } = await import('./registerServiceWorker');
    await expect(preparePrivateClientStorage()).resolves.toBeUndefined();
  });

  it('keeps unrelated hosted installations unchanged', async () => {
    window.__APP_CONFIG__ = { IS_SELF_HOST: 'false' };
    const { preparePrivateClientStorage } = await import('./registerServiceWorker');
    await preparePrivateClientStorage();
    expect(clear).not.toHaveBeenCalled();
  });
});
