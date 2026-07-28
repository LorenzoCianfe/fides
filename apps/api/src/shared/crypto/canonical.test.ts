import { describe, expect, it } from 'vitest';
import { stableStringify } from './canonical';

describe('stableStringify', () => {
  it('serializes identical objects identically regardless of key order', () => {
    const a = { amountMinor: '2500', currency: 'EUR', payee: { iban: 'DE89', name: 'Bob' } };
    const b = { payee: { name: 'Bob', iban: 'DE89' }, currency: 'EUR', amountMinor: '2500' };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('distinguishes different values and preserves array order', () => {
    expect(stableStringify({ tags: [1, 2] })).not.toBe(stableStringify({ tags: [2, 1] }));
    expect(stableStringify({ amount: '1' })).not.toBe(stableStringify({ amount: '2' }));
  });

  it('drops undefined entries, matching JSON semantics', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });

  it('handles primitives, null, and nested arrays of objects', () => {
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });
});
