import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { wipe, mark, assign } = vi.hoisted(() => ({
  wipe: vi.fn().mockResolvedValue(true),
  mark: vi.fn(),
  assign: vi.fn(),
}));
vi.mock('@/lib/query-client', () => ({ queryClient: {} }));
vi.mock('@/lib/query-persister', () => ({ resetQueryCaches: wipe }));
vi.mock('@/lib/connection-status', () => ({ markConnectionUnavailable: mark }));
const origin = 'https://raydenfinance.duckdns.org';
const response = () => new Response(null, { status: 401, headers: { 'X-Finance-Authentication': 'required' } });

describe('expired MFA response handling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('location', { origin, href: origin + '/personal-finance?to=2026-11-01', assign });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('wipes cached financial queries before one top-level MFA redirect, even with concurrent failures', async () => {
    const { handleFinanceGatewayResponse } = await import('./gateway-response');
    expect(
      await Promise.all([handleFinanceGatewayResponse(response()), handleFinanceGatewayResponse(response())]),
    ).toEqual([true, true]);
    expect(wipe).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(new URL(assign.mock.calls[0]![0]).searchParams.get('rd')).toBe(origin + '/personal-finance?to=2026-11-01');
    expect(wipe.mock.invocationCallOrder[0]).toBeLessThan(assign.mock.invocationCallOrder[0]!);
    expect(mark).toHaveBeenCalledWith('authentication');
  });

  it('does not turn an unavailable gateway or ordinary app-session error into a redirect loop', async () => {
    const { handleFinanceGatewayResponse } = await import('./gateway-response');
    expect(await handleFinanceGatewayResponse(new Response(null, { status: 503 }))).toBe(false);
    expect(await handleFinanceGatewayResponse(new Response(null, { status: 401 }))).toBe(false);
    expect(mark).toHaveBeenCalledWith('server');
    expect(assign).not.toHaveBeenCalled();
    expect(wipe).not.toHaveBeenCalled();
  });

  it('finishes an explicit logout rather than starting a competing login redirect', async () => {
    const { beginFinanceGatewayLogout, handleFinanceGatewayResponse } = await import('./gateway-response');
    beginFinanceGatewayLogout();
    expect(await handleFinanceGatewayResponse(response())).toBe(true);
    expect(assign).not.toHaveBeenCalled();
  });
});
