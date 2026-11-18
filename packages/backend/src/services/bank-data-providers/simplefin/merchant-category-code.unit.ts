import { normalizeMerchantCategoryCode } from './merchant-category-code';

describe('provider merchant category codes', () => {
  it('preserves leading zeroes and valid provider codes', () => {
    expect(normalizeMerchantCategoryCode('0012')).toBe('0012');
    expect(normalizeMerchantCategoryCode(12)).toBe('0012');
    expect(normalizeMerchantCategoryCode('5814')).toBe('5814');
  });
  it('does not turn missing or invalid data into a category', () => {
    for (const value of [null, undefined, '', 'bar', '12', -1, 12345, 1.5, {}]) {
      expect(normalizeMerchantCategoryCode(value)).toBeNull();
    }
  });
});
