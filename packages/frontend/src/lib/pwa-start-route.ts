/** Old iOS Home Screen shortcuts can retain the URL from installation. */
export function shouldOpenDashboardAtLaunch({
  initialNavigation,
  standalone,
  path,
  query,
}: {
  initialNavigation: boolean;
  standalone: boolean;
  path: string;
  query: Record<string, unknown>;
}): boolean {
  return initialNavigation && standalone && path === '/personal-finance' && Object.keys(query).length === 0;
}
