import { cents, money } from './calculations';

export interface LinkedProviderAccount {
  nativeAccountId: string;
  externalId: string;
  nativeCurrencyCode: string;
}
export interface ProviderValuation {
  id: string;
  balance: string;
  currency?: string;
  'balance-date'?: number;
}

/** Combined worksheet rows remain combined. A sum requires every linked
 * component to have an actual valuation on the same recorded day. */
export function combinedProviderValuation(
  links: LinkedProviderAccount[],
  values: ProviderValuation[],
  currencyCode: string,
) {
  if (!links.length) return null;
  const components = links.map((link) => {
    const value = values.find((v) => v.id === link.externalId);
    const timestamp = value?.['balance-date'];
    const rawCurrency = value?.currency?.toUpperCase();
    const currency = !rawCurrency || rawCurrency === 'XXX' ? link.nativeCurrencyCode : rawCurrency;
    if (!value || !timestamp || !Number.isFinite(timestamp) || currency !== currencyCode) return null;
    const instant = new Date(timestamp * 1000);
    if (!Number.isFinite(instant.valueOf()) || !value.balance.trim()) return null;
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
    try {
      return { date, balanceCents: cents(Number(value.balance)), key: `${link.nativeAccountId}:${timestamp}` };
    } catch {
      return null;
    }
  });
  if (components.some((c) => !c)) return null;
  const complete = components.filter((c) => c !== null);
  if (new Set(complete.map((c) => c.date)).size !== 1) return null;
  return {
    date: complete[0]!.date,
    balance: money(complete.reduce((sum, c) => sum + c.balanceCents, 0)),
    keys: complete.map((c) => c.key).sort(),
  };
}
