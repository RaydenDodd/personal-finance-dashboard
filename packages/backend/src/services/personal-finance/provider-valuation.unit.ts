import { describe, expect, it } from '@jest/globals';

import { combinedProviderValuation } from './provider-valuation';

const links = [
  { nativeAccountId: 'checking', externalId: 'a', nativeCurrencyCode: 'USD' },
  { nativeAccountId: 'cash-reserve', externalId: 'b', nativeCurrencyCode: 'USD' },
];
const values = [
  { id: 'a', balance: '10.25', currency: 'USD', 'balance-date': Date.parse('2026-11-05T12:00:00Z') / 1000 },
  { id: 'b', balance: '5.10', currency: 'USD', 'balance-date': Date.parse('2026-11-05T15:00:00Z') / 1000 },
];
describe('linked bank account group valuations', () => {
  it('combines cents on an actual shared valuation day without splitting historical totals', () => {
    expect(combinedProviderValuation(links, values, 'USD')).toMatchObject({ balance: 15.35, date: '2026-11-05' });
    expect(
      combinedProviderValuation(
        links,
        values.map((v) => ({ ...v, balance: '0.00' })),
        'USD',
      )?.balance,
    ).toBe(0);
  });
  it('does not publish a partial group or borrow another day’s balance', () => {
    expect(combinedProviderValuation(links, values.slice(0, 1), 'USD')).toBeNull();
    expect(
      combinedProviderValuation(
        links,
        [values[0]!, { ...values[1]!, 'balance-date': values[1]!['balance-date'] - 86400 }],
        'USD',
      ),
    ).toBeNull();
    expect(
      combinedProviderValuation(
        links,
        values.map((v) => ({ ...v, 'balance-date': undefined })),
        'USD',
      ),
    ).toBeNull();
  });
  it('uses the explicitly selected native currency only when the provider omits it', () => {
    expect(
      combinedProviderValuation(
        links,
        values.map((v) => ({ ...v, currency: undefined })),
        'USD',
      )?.balance,
    ).toBe(15.35);
    expect(combinedProviderValuation(links, [{ ...values[0]!, currency: 'EUR' }, values[1]!], 'USD')).toBeNull();
    expect(combinedProviderValuation(links, [{ ...values[0]!, balance: '' }, values[1]!], 'USD')).toBeNull();
  });
});
