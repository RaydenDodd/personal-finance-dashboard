import { Money } from '@common/types/money';

import { nativeExternalFlow } from './native-transfer';

describe('native funding adapter', () => {
  it('reads non-enumerable model getters and does not use an unused zero destination amount', () => {
    const row = {};
    for (const [key, value] of Object.entries({
      fromPortfolioId: null,
      toPortfolioId: 'portfolio',
      isAdjustment: false,
      refAmount: Money.fromDecimal('137.50'),
      refToAmount: Money.zero(),
      toCurrencyCode: null,
    }))
      Object.defineProperty(row, key, { get: () => value, enumerable: false });
    expect(Object.keys(row)).toEqual([]);
    expect(nativeExternalFlow(row as never, new Set(['portfolio']))).toBe('137.500000000000000000');
  });
  it('excludes internal movements and native adjustments', () => {
    const row = {
      fromPortfolioId: 'a',
      toPortfolioId: 'b',
      isAdjustment: false,
      refAmount: Money.fromDecimal('100'),
      refToAmount: Money.zero(),
      toCurrencyCode: null,
    };
    expect(nativeExternalFlow(row as never, new Set(['a', 'b']))).toBe('0');
    expect(nativeExternalFlow({ ...row, isAdjustment: true } as never, new Set(['b']))).toBe('0');
  });
});
