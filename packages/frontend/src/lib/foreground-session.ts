import { config } from '@/common/config';
import { markConnectionUnavailable, setForegroundSessionChecking } from '@/lib/connection-status';
import { FINANCE_PUBLIC_ORIGIN } from '@/lib/finance-gateway';

/** Hide a warm Home Screen view until the gateway and app session are checked again.
 * Keep the mounted view while checking, so a valid session retains its route and draft. */
export const installForegroundSessionCheck = (): (() => void) => {
  if (!config.isSelfHost || window.location.origin !== FINANCE_PUBLIC_ORIGIN) return () => {};
  let inFlight = false,
    disposed = false;
  const recheck = async () => {
    if (inFlight || disposed) return;
    inFlight = true;
    setForegroundSessionChecking(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${config.apiHttp || window.location.origin}${config.apiVer}/auth/get-session`, {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (disposed) return;
      const { handleFinanceGatewayResponse } = await import('@/lib/gateway-response');
      if (await handleFinanceGatewayResponse(response)) return;
      if (!response.ok) throw new Error('Session check unavailable');
      const session = await response.json();
      if (!session?.session || !session?.user) {
        const [{ queryClient }, { resetQueryCaches }] = await Promise.all([
          import('@/lib/query-client'),
          import('@/lib/query-persister'),
        ]);
        await resetQueryCaches(queryClient);
        window.location.assign(`${FINANCE_PUBLIC_ORIGIN}/sign-in`);
        return;
      }
      if (!disposed && document.visibilityState === 'visible') setForegroundSessionChecking(false);
    } catch {
      if (!disposed) markConnectionUnavailable('server');
    } finally {
      clearTimeout(timer);
      inFlight = false;
    }
  };
  const hide = () => setForegroundSessionChecking(true);
  const visibility = () => {
    if (document.visibilityState === 'hidden') hide();
    else void recheck();
  };
  const pageShow = (event: PageTransitionEvent) => {
    if (event.persisted) void recheck();
  };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', pageShow);
  if (document.visibilityState === 'hidden') hide();
  return () => {
    disposed = true;
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', hide);
    window.removeEventListener('pageshow', pageShow);
  };
};
