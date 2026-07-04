import { describe, expect, it } from 'vitest';
import { divideRound, type RoundingMode } from './rounding';

describe('divideRound', () => {
  it('returns the exact quotient when the division is exact', () => {
    expect(divideRound(9n, 3n, 'HALF_UP')).toBe(3n);
    expect(divideRound(0n, 5n, 'HALF_EVEN')).toBe(0n);
    expect(divideRound(-12n, 4n, 'DOWN')).toBe(-3n);
  });

  it('throws on division by zero', () => {
    expect(() => divideRound(1n, 0n)).toThrow(RangeError);
  });

  it('normalizes a negative denominator', () => {
    expect(divideRound(10n, -4n, 'HALF_UP')).toBe(-3n);
    expect(divideRound(-10n, -4n, 'HALF_UP')).toBe(3n);
  });

  // 2.5 and -2.5 exercise every tie-breaking rule.
  const ties: Array<[RoundingMode, bigint, bigint]> = [
    ['HALF_UP', 3n, -3n],
    ['HALF_DOWN', 2n, -2n],
    ['HALF_EVEN', 2n, -2n], // 2 is even
    ['UP', 3n, -3n],
    ['DOWN', 2n, -2n],
    ['CEIL', 3n, -2n],
    ['FLOOR', 2n, -3n],
  ];

  it.each(ties)('rounds +/-2.5 under %s', (mode, positive, negative) => {
    expect(divideRound(10n, 4n, mode)).toBe(positive);
    expect(divideRound(-10n, 4n, mode)).toBe(negative);
  });

  it('rounds 3.5 to even under HALF_EVEN', () => {
    expect(divideRound(14n, 4n, 'HALF_EVEN')).toBe(4n); // 4 is even
    expect(divideRound(-14n, 4n, 'HALF_EVEN')).toBe(-4n);
  });

  it('handles non-halfway remainders consistently', () => {
    expect(divideRound(10n, 3n, 'HALF_UP')).toBe(3n); // 3.33 -> 3
    expect(divideRound(11n, 3n, 'HALF_DOWN')).toBe(4n); // 3.67 -> 4
    expect(divideRound(10n, 3n, 'UP')).toBe(4n);
    expect(divideRound(10n, 3n, 'DOWN')).toBe(3n);
    expect(divideRound(-10n, 3n, 'CEIL')).toBe(-3n);
    expect(divideRound(-10n, 3n, 'FLOOR')).toBe(-4n);
  });

  it('applies an FX-style rate exactly', () => {
    // 1050 minor * 1.0954 = 1150.17 -> 1150
    expect(divideRound(1050n * 10954n, 10000n, 'HALF_UP')).toBe(1150n);
  });
});
