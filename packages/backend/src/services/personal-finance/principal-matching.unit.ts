import { describe, expect, it } from '@jest/globals';

import {
  cashFlowIdFromNote,
  isRecordedDate,
  isReturnOrAwardDescription,
  matchPrincipalEvidence,
} from './principal-matching';
import type { PrincipalImportRecord } from './principal-types';
import type { FinanceCashFlow } from './types';
const record = (extra: Partial<PrincipalImportRecord> = {}): PrincipalImportRecord => ({
  accountId: 'investment',
  date: '2026-11-06',
  amount: 200,
  type: 'contribution',
  source: 'google-sheets',
  sourceId: 'sheet',
  sourceKey: 'R51C53',
  verified: true,
  ...extra,
});
const flow = (extra: Partial<FinanceCashFlow> = {}): FinanceCashFlow => ({
  id: 'bank-flow',
  accountId: 'investment',
  date: '2026-11-09',
  amount: 200,
  type: 'contribution',
  toAccountId: null,
  opening: false,
  description: '',
  createdAt: '',
  source: 'bank-transfer',
  verified: true,
  ...extra,
});
describe('principal evidence reconciliation', () => {
  it('matches initiation and receipt dates without duplicating a verified bank contribution', () => {
    expect(matchPrincipalEvidence(record(), [flow()]).match?.id).toBe('bank-flow');
    expect(matchPrincipalEvidence(record(), [flow({ date: '2026-11-16' })]).match).toBeNull();
  });
  it('keeps two real equal deposits from the same source separate', () => {
    expect(matchPrincipalEvidence(record(), [flow({ source: 'google-sheets' })])).toEqual({
      match: null,
      ambiguous: false,
    });
  });
  it('requires review for ambiguous equal transfers or an already recorded combined contribution', () => {
    expect(matchPrincipalEvidence(record(), [flow(), flow({ id: 'second' })]).ambiguous).toBe(true);
    expect(matchPrincipalEvidence(record(), [flow({ amount: 100 }), flow({ id: 'travel', amount: 100 })])).toEqual({
      match: null,
      ambiguous: true,
    });
  });
  it('does not match an employer contribution to an employee contribution or an opening checkpoint', () => {
    expect(
      matchPrincipalEvidence(record({ contributionKind: 'employee' }), [flow({ contributionKind: 'employer' })]).match,
    ).toBeNull();
    expect(matchPrincipalEvidence(record({ opening: true }), [flow()]).match).toBeNull();
  });
  it('rejects invalid dates and identifies distributions that cannot create new cash principal', () => {
    expect(isRecordedDate('2026-02-30')).toBe(false);
    expect(isRecordedDate('2026-11-05')).toBe(true);
    for (const text of ['Dividend reinvestment purchase', 'Cash dividend', 'Interest payment', 'Free stock award'])
      expect(isReturnOrAwardDescription(text)).toBe(true);
    expect(isReturnOrAwardDescription('Withdrawal from M1 PAYMENTS')).toBe(false);
    expect(cashFlowIdFromNote('Date: 2026-11-05\nMoneyMatter cash-flow: 11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });
});
