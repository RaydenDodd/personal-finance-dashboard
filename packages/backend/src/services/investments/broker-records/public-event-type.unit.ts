import { describe, expect, it } from '@jest/globals';

import { publicSecurityTypeLookup } from './public-event-type';
describe('Public event instrument types', () => {
  it('uses a corroborated account instrument when dividend type is absent', () => {
    expect(publicSecurityTypeLookup([{ symbol: 'EXAMPLE', type: 'EQUITY' }])('EXAMPLE', null)).toBe('EQUITY');
  });
  it('does not guess when account instruments share a ticker across asset classes', () => {
    expect(
      publicSecurityTypeLookup([
        { symbol: 'EXAMPLE', type: 'EQUITY' },
        { symbol: 'EXAMPLE', type: 'CRYPTO' },
      ])('EXAMPLE', null),
    ).toBeNull();
  });
  it('keeps explicit event metadata and leaves unknown symbols unresolved', () => {
    const lookup = publicSecurityTypeLookup([]);
    expect(lookup('EXAMPLE', 'EQUITY')).toBe('EQUITY');
    expect(lookup('UNKNOWN', null)).toBeNull();
  });
});
