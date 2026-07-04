import { describe, expect, it } from 'vitest';
import {
  BASE_CURRENCY,
  type CurrencyCode,
  getCurrency,
  isCurrencyCode,
  listCurrencies,
} from './currency';

describe('currency registry', () => {
  it('uses EUR as the base currency', () => {
    expect(BASE_CURRENCY).toBe('EUR');
  });

  it('exposes correct minor-unit exponents', () => {
    expect(getCurrency('EUR').minorUnits).toBe(2);
    expect(getCurrency('JPY').minorUnits).toBe(0);
  });

  it('narrows valid codes and rejects invalid ones', () => {
    expect(isCurrencyCode('EUR')).toBe(true);
    expect(isCurrencyCode('XXX')).toBe(false);
    expect(isCurrencyCode(978)).toBe(false);
    expect(isCurrencyCode(undefined)).toBe(false);
  });

  it('throws for an unknown code passed at runtime', () => {
    expect(() => getCurrency('XXX' as CurrencyCode)).toThrow(RangeError);
  });

  it('lists all registered currencies', () => {
    const codes = listCurrencies().map((c) => c.code);
    expect(codes).toContain('EUR');
    expect(codes).toContain('JPY');
    expect(codes.length).toBe(9);
  });
});
