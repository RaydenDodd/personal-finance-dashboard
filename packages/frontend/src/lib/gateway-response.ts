import { markConnectionUnavailable } from '@/lib/connection-status';
import { financeGatewayLoginUrl, requiresFinanceGatewayAuthentication } from '@/lib/finance-gateway';

let navigatingToGateway = false;
let gatewayLogoutInProgress = false;

export const beginFinanceGatewayLogout = () => {
  gatewayLogoutInProgress = true;
  markConnectionUnavailable('authentication');
};

/** A proxy response never gets to supply a redirect target or overwrite app-session handling. */
export async function handleFinanceGatewayResponse(response: Response): Promise<boolean> {
  if ([502, 503, 504].includes(response.status)) markConnectionUnavailable('server');
  if (!requiresFinanceGatewayAuthentication(response, window.location.href)) return false;
  markConnectionUnavailable('authentication');
  if (gatewayLogoutInProgress) return true;
  if (!navigatingToGateway) {
    navigatingToGateway = true;
    const [{ queryClient }, { resetQueryCaches }] = await Promise.all([
      import('@/lib/query-client'),
      import('@/lib/query-persister'),
    ]);
    await resetQueryCaches(queryClient);
    window.location.assign(financeGatewayLoginUrl(window.location.href)!);
  }
  return true;
}
