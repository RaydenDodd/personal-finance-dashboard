import { describe, it, expect } from 'vitest';

import { randomUuid } from './random-id';
describe('private HTTP widget identifiers', () => {
  it('creates valid distinct UUIDs without crypto.randomUUID', () => {
    const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const a = randomUuid(),
        b = randomUuid();
      expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(b).not.toBe(a);
    } finally {
      if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor);
      else delete (crypto as unknown as Record<string, unknown>).randomUUID;
    }
  });
});
