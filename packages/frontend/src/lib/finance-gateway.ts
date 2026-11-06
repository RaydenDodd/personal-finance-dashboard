/** The public gateway is deliberately independent of private LAN/SSH authentication. */
export const FINANCE_PUBLIC_ORIGIN = 'https://raydenfinance.duckdns.org';

export const financeGatewayLoginUrl = (href: string): string | null => {
  const current = new URL(href);
  if (current.origin !== FINANCE_PUBLIC_ORIGIN || current.pathname.startsWith('/authelia')) return null;
  const login = new URL('/authelia/', current.origin);
  login.searchParams.set('rd', current.href);
  return login.href;
};

export const financeGatewayLogoutUrl = (origin: string): string | null =>
  origin === FINANCE_PUBLIC_ORIGIN ? `${FINANCE_PUBLIC_ORIGIN}/authelia/logout` : null;

export const requiresFinanceGatewayAuthentication = (response: Response, href: string): boolean =>
  response.status === 401 &&
  response.headers.get('X-Finance-Authentication') === 'required' &&
  financeGatewayLoginUrl(href) !== null;
