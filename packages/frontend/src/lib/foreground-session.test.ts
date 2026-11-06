import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { checking, unavailable, handleGateway, wipe, assign } = vi.hoisted(() => ({
  checking: vi.fn(),
  unavailable: vi.fn(),
  handleGateway: vi.fn().mockResolvedValue(false),
  wipe: vi.fn().mockResolvedValue(true),
  assign: vi.fn(),
}));
vi.mock('@/lib/connection-status', () => ({
  setForegroundSessionChecking: checking,
  markConnectionUnavailable: unavailable,
}));
vi.mock('@/lib/gateway-response', () => ({ handleFinanceGatewayResponse: handleGateway }));
vi.mock('@/lib/query-client', () => ({ queryClient: {} }));
vi.mock('@/lib/query-persister', () => ({ resetQueryCaches: wipe }));
const origin = 'https://raydenfinance.duckdns.org';
let cleanup = () => {};

describe('Home Screen foreground privacy', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    window.__APP_CONFIG__ = { IS_SELF_HOST: 'true' };
    vi.stubGlobal('location', { origin, href: origin + '/personal-finance', assign });
  });
  afterEach(() => {
    cleanup();
    delete window.__APP_CONFIG__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it('hides the warm view while backgrounded and only reveals it after a fresh credentialed session response', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    let answer: ((response: Response) => void) | undefined;
    const fetch = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const { installForegroundSessionCheck } = await import('./foreground-session');
    cleanup = installForegroundSessionCheck();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(checking).toHaveBeenLastCalledWith(true);
    expect(fetch).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      origin + '/api/v1/auth/get-session',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
    expect(answer).toBeDefined();
    answer!(new Response(JSON.stringify({ session: { id: 'fixture' }, user: { id: 'fixture' } }), { status: 200 }));
    await vi.waitFor(() => expect(checking).toHaveBeenLastCalledWith(false));
    expect(assign).not.toHaveBeenCalled();
  });
  it('keeps private data hidden and shows connection failure if the server is unavailable', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { installForegroundSessionCheck } = await import('./foreground-session');
    cleanup = installForegroundSessionCheck();
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(unavailable).toHaveBeenCalledWith('server'));
    expect(checking).not.toHaveBeenCalledWith(false);
  });
  it('wipes cached queries before returning an expired MoneyMatter session to sign-in', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('null', { status: 200 })));
    const { installForegroundSessionCheck } = await import('./foreground-session');
    cleanup = installForegroundSessionCheck();
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(origin + '/sign-in'));
    expect(wipe.mock.invocationCallOrder[0]).toBeLessThan(assign.mock.invocationCallOrder[0]!);
    expect(checking).not.toHaveBeenCalledWith(false);
  });
  it('does not alter private LAN or SSH browser-session behavior', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost:8095' });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { installForegroundSessionCheck } = await import('./foreground-session');
    cleanup = installForegroundSessionCheck();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetch).not.toHaveBeenCalled();
    expect(checking).not.toHaveBeenCalled();
  });
});
