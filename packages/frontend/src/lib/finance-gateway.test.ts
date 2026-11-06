import { describe, expect, it } from 'vitest';

import {
  FINANCE_PUBLIC_ORIGIN,
  financeGatewayLoginUrl,
  financeGatewayLogoutUrl,
  requiresFinanceGatewayAuthentication,
} from './finance-gateway';

describe('finance gateway boundary', () => {
  it('keeps the complete same-origin route as the return destination', () => {
    const target = `${FINANCE_PUBLIC_ORIGIN}/personal-finance?to=2026-11-01#history`;
    const login = new URL(financeGatewayLoginUrl(target)!);
    expect(login.origin).toBe(FINANCE_PUBLIC_ORIGIN);
    expect(login.pathname).toBe('/authelia/');
    expect(login.searchParams.get('rd')).toBe(target);
  });

  it.each([
    'http://localhost:8095',
    'http://192.168.0.32:8095',
    'https://raydenfinance.duckdns.org.attacker.example',
    'http://raydenfinance.duckdns.org',
  ])('never redirects private or lookalike origin %s', (origin) => {
    expect(financeGatewayLoginUrl(origin + '/dashboard')).toBeNull();
    expect(financeGatewayLogoutUrl(origin)).toBeNull();
  });

  it('requires both the proxy marker and 401, and does not loop inside the portal', () => {
    const required = new Response(null, { status: 401, headers: { 'X-Finance-Authentication': 'required' } });
    expect(requiresFinanceGatewayAuthentication(required, FINANCE_PUBLIC_ORIGIN + '/dashboard')).toBe(true);
    expect(requiresFinanceGatewayAuthentication(required, FINANCE_PUBLIC_ORIGIN + '/authelia/')).toBe(false);
    expect(requiresFinanceGatewayAuthentication(new Response(null, { status: 401 }), FINANCE_PUBLIC_ORIGIN)).toBe(
      false,
    );
    expect(
      requiresFinanceGatewayAuthentication(
        new Response(null, { status: 503, headers: { 'X-Finance-Authentication': 'required' } }),
        FINANCE_PUBLIC_ORIGIN,
      ),
    ).toBe(false);
    expect(financeGatewayLogoutUrl(FINANCE_PUBLIC_ORIGIN)).toBe(FINANCE_PUBLIC_ORIGIN + '/authelia/logout');
  });
});
