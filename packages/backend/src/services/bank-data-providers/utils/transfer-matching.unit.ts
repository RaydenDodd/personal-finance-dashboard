import { describe, expect, it } from '@jest/globals';

import { hasExplicitTransferDescription } from './transfer-matching';
describe('positive evidence for neutral transfer matches', () => {
  it('does not turn a restaurant purchase or ATM cash deposit into a transfer merely because amounts match', () => {
    expect(hasExplicitTransferDescription('SMOKESHACK BBQ GLEN ROCK PA')).toBe(false);
    expect(hasExplicitTransferDescription('ATM Deposit (Cash)')).toBe(false);
    expect(hasExplicitTransferDescription('AplPay APPLE.COM/BILL')).toBe(false);
  });
  it('recognizes explicit owned funding and credit-card payment descriptions', () => {
    for (const note of [
      'Deposit from Safe Checking XXXXXXX8415',
      'Withdrawal to Car Fund XXXXXXX8078',
      'M1',
      'AMEX EPAYMENT',
      'MOBILE PAYMENT - THANK YOU',
      'Payment Thank You',
    ])
      expect(hasExplicitTransferDescription(note)).toBe(true);
  });
});
