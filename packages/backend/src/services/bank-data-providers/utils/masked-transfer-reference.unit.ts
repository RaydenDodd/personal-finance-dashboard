import { describe, expect, it } from '@jest/globals';

import { buildAccountSuffixes, maskedTransferReferenceRelation } from './masked-transfer-reference';

const accountSuffixes = buildAccountSuffixes([
  { id: 'checking', name: 'Checking (1111)' },
  { id: 'savings', name: 'Savings (2222)' },
  { id: 'reserve', name: 'Reserve (3333)' },
]);
const a = { accountId: 'checking', note: 'Withdrawal to Savings XXXXXXX2222' };
const b = { accountId: 'savings', note: 'Deposit from Checking XXXXXXX1111' };
const relation = (first = a, second = b, suffixes = accountSuffixes) =>
  maskedTransferReferenceRelation({ a: first, b: second, accountSuffixes: suffixes });
describe('explicit masked own-account transfer references', () => {
  it('confirms the actual destination rather than an equal-amount transfer to another account', () => {
    expect(relation()).toBe('confirmed');
    expect(relation(a, { ...b, accountId: 'reserve' })).toBe('contradicted');
  });
  it('vetoes conflicting evidence on either leg', () => {
    expect(relation(a, { ...b, note: 'Deposit from Reserve XXXXXXX3333' })).toBe('contradicted');
  });
  it('ignores merchant names and unmasked numbers', () => {
    expect(relation({ ...a, note: 'Purchase at Public Storage 2222' }, { ...b, note: 'Refund 1111' })).toBe('neutral');
    expect(relation({ ...a, note: 'Withdrawal to Savings 2222' }, { ...b, note: null as unknown as string })).toBe(
      'neutral',
    );
  });
  it('does not identify an account from an ambiguous suffix', () => {
    const duplicates = buildAccountSuffixes([
      { id: 'a', name: 'Bank A (1111)' },
      { id: 'b', name: 'Bank B (1111)' },
    ]);
    expect(duplicates.size).toBe(0);
    expect(relation(a, b, duplicates)).toBe('neutral');
  });
});
