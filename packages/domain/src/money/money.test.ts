import { describe, expect, it } from 'vitest';
import {
  CurrencyMismatchError,
  MoneyPrecisionError,
  UnknownCurrencyError,
} from '../errors/domain-error';
import { type CurrencyCode } from './currency';
import { Money } from './money';

const eur = (value: string) => Money.fromDecimal(value, 'EUR');

describe('Money construction', () => {
  it('builds from integer minor units', () => {
    expect(Money.fromMinor(1050n, 'EUR').amount).toBe(1050n);
    expect(Money.fromMinor(1050, 'EUR').amount).toBe(1050n);
  });

  it('rejects non-integer or unsafe numeric minor units', () => {
    expect(() => Money.fromMinor(1.5, 'EUR')).toThrow(MoneyPrecisionError);
    expect(() => Money.fromMinor(Number.MAX_SAFE_INTEGER + 2, 'EUR')).toThrow(MoneyPrecisionError);
  });

  it('parses decimal strings to minor units', () => {
    expect(eur('10.50').amount).toBe(1050n);
    expect(eur('10.5').amount).toBe(1050n);
    expect(eur('10').amount).toBe(1000n);
    expect(eur('-3.21').amount).toBe(-321n);
    expect(Money.fromDecimal('100', 'JPY').amount).toBe(100n);
  });

  it('rejects values more precise than the currency allows', () => {
    expect(() => eur('10.505')).toThrow(MoneyPrecisionError);
    expect(() => Money.fromDecimal('100.5', 'JPY')).toThrow(MoneyPrecisionError);
    expect(() => eur('abc')).toThrow(MoneyPrecisionError);
  });

  it('rejects an unknown currency at the boundary', () => {
    expect(() => Money.fromMinor(1n, 'XXX' as CurrencyCode)).toThrow(UnknownCurrencyError);
  });

  it('creates a typed zero', () => {
    expect(Money.zero('EUR').isZero()).toBe(true);
  });
});

describe('Money arithmetic', () => {
  it('adds and subtracts same-currency values', () => {
    expect(eur('10.50').add(eur('0.50')).amount).toBe(1100n);
    expect(eur('10.00').subtract(eur('3.50')).amount).toBe(650n);
  });

  it('throws on cross-currency arithmetic', () => {
    const usd = Money.fromDecimal('1.00', 'USD');
    expect(() => eur('1.00').add(usd)).toThrow(CurrencyMismatchError);
    expect(() => eur('1.00').subtract(usd)).toThrow(CurrencyMismatchError);
  });

  it('negates and takes absolute value', () => {
    expect(eur('5.00').negate().amount).toBe(-500n);
    expect(eur('-5.00').abs().amount).toBe(500n);
  });

  it('is immutable — operations return new instances', () => {
    const base = eur('10.00');
    base.add(eur('1.00'));
    expect(base.amount).toBe(1000n);
  });

  it('multiplies by integers, bigints, and decimal-string rates', () => {
    expect(eur('3.00').multiply(3).amount).toBe(900n);
    expect(eur('3.00').multiply(2n).amount).toBe(600n);
    // 1050 * 1.0954 = 1150.17 -> 1150 (HALF_UP default)
    expect(eur('10.50').multiply('1.0954').amount).toBe(1150n);
    expect(eur('10.50').multiply('0.1').amount).toBe(105n);
  });

  it('respects an explicit rounding mode', () => {
    // 250 * 1.005 = 251.25 -> HALF_UP 251, DOWN 251 as well; use a true tie
    // 100 * 1.005 = 100.5 -> HALF_UP 101, HALF_EVEN 100
    expect(eur('1.00').multiply('1.005', 'HALF_UP').amount).toBe(101n);
    expect(eur('1.00').multiply('1.005', 'HALF_EVEN').amount).toBe(100n);
  });

  it('rejects unsafe numeric factors', () => {
    expect(() => eur('1.00').multiply(1e-7)).toThrow(MoneyPrecisionError);
    expect(() => eur('1.00').multiply(Number.POSITIVE_INFINITY)).toThrow(MoneyPrecisionError);
  });
});

describe('Money.allocate', () => {
  it('splits without losing a minor unit', () => {
    const parts = eur('10.00').allocate([1, 1, 1]);
    expect(parts.map((p) => p.amount)).toEqual([334n, 333n, 333n]);
  });

  it('distributes a remainder deterministically from the front', () => {
    expect(
      eur('10.01')
        .allocate([1, 1])
        .map((p) => p.amount),
    ).toEqual([501n, 500n]);
  });

  it('preserves the total for any weights', () => {
    const total = eur('99.99');
    const parts = total.allocate([2, 3, 5]);
    const sum = parts.reduce((acc, p) => acc.add(p), Money.zero('EUR'));
    expect(sum.equals(total)).toBe(true);
  });

  it('handles negative amounts', () => {
    expect(
      eur('-10.00')
        .allocate([1, 1, 1])
        .map((p) => p.amount),
    ).toEqual([-334n, -333n, -333n]);
  });

  it('rejects invalid weights', () => {
    expect(() => eur('1.00').allocate([])).toThrow(MoneyPrecisionError);
    expect(() => eur('1.00').allocate([0, 0])).toThrow(MoneyPrecisionError);
    expect(() => eur('1.00').allocate([1, -1])).toThrow(MoneyPrecisionError);
  });
});

describe('Money comparison', () => {
  it('compares same-currency values', () => {
    expect(eur('10.00').compareTo(eur('5.00'))).toBe(1);
    expect(eur('5.00').compareTo(eur('10.00'))).toBe(-1);
    expect(eur('5.00').compareTo(eur('5.00'))).toBe(0);
    expect(eur('10.00').greaterThan(eur('5.00'))).toBe(true);
    expect(eur('5.00').lessThanOrEqual(eur('5.00'))).toBe(true);
  });

  it('equals is currency-aware and never throws', () => {
    expect(eur('1.00').equals(Money.fromDecimal('1.00', 'USD'))).toBe(false);
    expect(eur('1.00').equals(eur('1.00'))).toBe(true);
  });

  it('throws when comparing across currencies', () => {
    expect(() => eur('1.00').compareTo(Money.fromDecimal('1.00', 'USD'))).toThrow(
      CurrencyMismatchError,
    );
  });

  it('classifies sign', () => {
    expect(eur('1.00').isPositive()).toBe(true);
    expect(eur('-1.00').isNegative()).toBe(true);
    expect(Money.zero('EUR').isZero()).toBe(true);
  });
});

describe('Money formatting and serialization', () => {
  it('renders a plain decimal string', () => {
    expect(eur('10.50').toDecimalString()).toBe('10.50');
    expect(eur('-3.21').toDecimalString()).toBe('-3.21');
    expect(Money.fromMinor(5n, 'EUR').toDecimalString()).toBe('0.05');
    expect(Money.zero('EUR').toDecimalString()).toBe('0.00');
    expect(Money.fromMinor(100n, 'JPY').toDecimalString()).toBe('100');
  });

  it('round-trips through JSON', () => {
    const original = eur('1234.56');
    const restored = Money.fromJSON(original.toJSON());
    expect(restored.equals(original)).toBe(true);
    expect(original.toJSON()).toEqual({ amount: '123456', currency: 'EUR' });
  });

  it('produces a locale-aware display string', () => {
    const formatted = eur('10.50').format('de-DE');
    expect(formatted).toContain('€');
    expect(typeof formatted).toBe('string');
  });

  it('has a readable toString', () => {
    expect(eur('10.50').toString()).toBe('10.50 EUR');
  });
});
