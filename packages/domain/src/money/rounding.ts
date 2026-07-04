/**
 * Float-free rounding primitives.
 *
 * All monetary rounding in the platform reduces to rounding an exact rational
 * `numerator / denominator` (both integers, held as `bigint`) to the nearest
 * integer under an explicit, documented rounding mode. No floating-point
 * arithmetic is ever used, so results are deterministic and reproducible.
 */

export type RoundingMode =
  | 'HALF_UP' // ties away from zero (default for customer-facing amounts)
  | 'HALF_DOWN' // ties toward zero
  | 'HALF_EVEN' // banker's rounding; ties to the nearest even integer
  | 'UP' // away from zero
  | 'DOWN' // toward zero (truncate)
  | 'CEIL' // toward +infinity
  | 'FLOOR'; // toward -infinity

/** The platform default rounding mode. Documented in ADR-0018. */
export const DEFAULT_ROUNDING_MODE: RoundingMode = 'HALF_UP';

/**
 * Divide `numerator` by `denominator` and round the exact quotient to an
 * integer using the given rounding mode. Exact and float-free.
 *
 * @throws {RangeError} if `denominator` is zero.
 */
export function divideRound(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE,
): bigint {
  if (denominator === 0n) {
    throw new RangeError('divideRound: denominator must not be zero');
  }

  // Normalize the sign onto the numerator so the denominator is positive.
  let num = numerator;
  let den = denominator;
  if (den < 0n) {
    num = -num;
    den = -den;
  }

  const negative = num < 0n;
  const absNum = negative ? -num : num;
  const quotient = absNum / den; // truncated toward zero (both operands >= 0)
  const remainder = absNum - quotient * den; // 0 <= remainder < den

  if (remainder === 0n) {
    return negative ? -quotient : quotient;
  }

  const roundedUp = shouldRoundUp(quotient, remainder, den, negative, mode);
  const magnitude = roundedUp ? quotient + 1n : quotient;
  return negative ? -magnitude : magnitude;
}

function shouldRoundUp(
  quotient: bigint,
  remainder: bigint,
  denominator: bigint,
  negative: boolean,
  mode: RoundingMode,
): boolean {
  const twiceRemainder = remainder * 2n;

  switch (mode) {
    case 'DOWN':
      return false;
    case 'UP':
      return true;
    case 'FLOOR':
      // Toward -infinity: negatives grow in magnitude, positives truncate.
      return negative;
    case 'CEIL':
      // Toward +infinity: positives grow in magnitude, negatives truncate.
      return !negative;
    case 'HALF_UP':
      return twiceRemainder >= denominator;
    case 'HALF_DOWN':
      return twiceRemainder > denominator;
    case 'HALF_EVEN':
      if (twiceRemainder > denominator) return true;
      if (twiceRemainder < denominator) return false;
      // Exactly halfway: round to make the result even.
      return quotient % 2n === 1n;
    default: {
      const exhaustive: never = mode;
      throw new RangeError(`divideRound: unsupported rounding mode ${String(exhaustive)}`);
    }
  }
}
