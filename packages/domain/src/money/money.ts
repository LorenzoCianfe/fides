import {
  CurrencyMismatchError,
  MoneyPrecisionError,
  UnknownCurrencyError,
} from '../errors/domain-error';
import { getCurrency, isCurrencyCode, type CurrencyCode } from './currency';
import { divideRound, DEFAULT_ROUNDING_MODE, type RoundingMode } from './rounding';

/** Serialized form of a {@link Money} value (safe for JSON transport). */
export interface MoneyJSON {
  /** Integer minor units, as a base-10 string (bigint-safe). */
  readonly amount: string;
  readonly currency: CurrencyCode;
}

/** A scalar factor accepted by {@link Money.multiply}. */
export type MoneyFactor = string | number | bigint;

/**
 * Immutable, currency-safe monetary value.
 *
 * Amounts are held as integer **minor units** (`bigint`) with an explicit
 * currency — never as floating-point numbers. Arithmetic between different
 * currencies throws; conversions that would lose precision throw. All rounding
 * is explicit and float-free (see {@link divideRound}).
 */
export class Money {
  private constructor(
    /** Integer minor units (e.g. cents for EUR). */
    readonly amount: bigint,
    readonly currency: CurrencyCode,
  ) {}

  /** Construct from integer minor units. */
  static fromMinor(amount: bigint | number, currency: CurrencyCode): Money {
    assertCurrency(currency);
    return new Money(toBigIntExact(amount), currency);
  }

  /**
   * Construct from a major-unit decimal string (e.g. `"10.50"` EUR → 1050).
   *
   * @throws {MoneyPrecisionError} if the value carries more decimal places than
   *   the currency supports, or is not a valid decimal.
   */
  static fromDecimal(value: string, currency: CurrencyCode): Money {
    assertCurrency(currency);
    const { minorUnits } = getCurrency(currency);
    const { numerator, denominator } = parseDecimal(value);
    const scaled = numerator * 10n ** BigInt(minorUnits);
    if (scaled % denominator !== 0n) {
      throw new MoneyPrecisionError(
        `Value "${value}" exceeds the precision of ${currency} (${minorUnits} decimal places)`,
        { value, currency, minorUnits },
      );
    }
    return new Money(scaled / denominator, currency);
  }

  /** The zero value in the given currency. */
  static zero(currency: CurrencyCode): Money {
    assertCurrency(currency);
    return new Money(0n, currency);
  }

  /** Rehydrate from {@link MoneyJSON}. */
  static fromJSON(json: MoneyJSON): Money {
    assertCurrency(json.currency);
    return new Money(BigInt(json.amount), json.currency);
  }

  // --- Arithmetic -----------------------------------------------------------

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount - other.amount, this.currency);
  }

  negate(): Money {
    return new Money(-this.amount, this.currency);
  }

  abs(): Money {
    return new Money(this.amount < 0n ? -this.amount : this.amount, this.currency);
  }

  /**
   * Multiply by a scalar factor, rounding the result to whole minor units.
   * The factor may be an integer, a `bigint`, or a decimal string (preferred
   * for exact rates, e.g. an FX rate `"1.0954"`).
   */
  multiply(factor: MoneyFactor, mode: RoundingMode = DEFAULT_ROUNDING_MODE): Money {
    const { numerator, denominator } = factorToFraction(factor);
    return new Money(divideRound(this.amount * numerator, denominator, mode), this.currency);
  }

  /**
   * Split the amount across integer weights with no minor unit lost. Any
   * rounding remainder is distributed one minor unit at a time, in order.
   */
  allocate(weights: readonly number[]): Money[] {
    if (weights.length === 0) {
      throw new MoneyPrecisionError('allocate: at least one weight is required', {
        weights: [...weights],
      });
    }
    const bigWeights = weights.map((w) => {
      if (!Number.isInteger(w) || w < 0) {
        throw new MoneyPrecisionError('allocate: weights must be non-negative integers', {
          weights: [...weights],
        });
      }
      return BigInt(w);
    });
    const total = bigWeights.reduce((sum, w) => sum + w, 0n);
    if (total === 0n) {
      throw new MoneyPrecisionError('allocate: the sum of weights must be greater than zero', {
        weights: [...weights],
      });
    }

    let remainder = this.amount;
    const shares = bigWeights.map((w) => {
      const share = (this.amount * w) / total; // truncates toward zero
      remainder -= share;
      return share;
    });

    const step = remainder >= 0n ? 1n : -1n;
    for (let i = 0; remainder !== 0n; i = (i + 1) % shares.length) {
      shares[i] = (shares[i] as bigint) + step;
      remainder -= step;
    }

    return shares.map((amount) => new Money(amount, this.currency));
  }

  // --- Comparison -----------------------------------------------------------

  compareTo(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.amount < other.amount) return -1;
    if (this.amount > other.amount) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount === other.amount;
  }

  greaterThan(other: Money): boolean {
    return this.compareTo(other) === 1;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.compareTo(other) >= 0;
  }

  lessThan(other: Money): boolean {
    return this.compareTo(other) === -1;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.compareTo(other) <= 0;
  }

  isZero(): boolean {
    return this.amount === 0n;
  }

  isPositive(): boolean {
    return this.amount > 0n;
  }

  isNegative(): boolean {
    return this.amount < 0n;
  }

  // --- Formatting -----------------------------------------------------------

  /** Plain decimal string with the currency's precision, e.g. `"-1234.56"`. */
  toDecimalString(): string {
    const { minorUnits } = getCurrency(this.currency);
    const negative = this.amount < 0n;
    const digits = (negative ? -this.amount : this.amount).toString().padStart(minorUnits + 1, '0');
    const cut = digits.length - minorUnits;
    const fraction = minorUnits > 0 ? `.${digits.slice(cut)}` : '';
    return `${negative ? '-' : ''}${digits.slice(0, cut)}${fraction}`;
  }

  /**
   * Locale-aware currency string for display only. Uses `Intl.NumberFormat`
   * (double precision) and must not be used for calculations.
   */
  format(locale = 'en-US'): string {
    const { minorUnits } = getCurrency(this.currency);
    const value = Number(this.amount) / 10 ** minorUnits;
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.currency,
      minimumFractionDigits: minorUnits,
      maximumFractionDigits: minorUnits,
    }).format(value);
  }

  toJSON(): MoneyJSON {
    return { amount: this.amount.toString(), currency: this.currency };
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.currency}`;
  }

  // --- Internals ------------------------------------------------------------

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}

function assertCurrency(currency: CurrencyCode): void {
  if (!isCurrencyCode(currency)) {
    throw new UnknownCurrencyError(String(currency));
  }
}

function toBigIntExact(amount: bigint | number): bigint {
  if (typeof amount === 'bigint') return amount;
  if (!Number.isInteger(amount)) {
    throw new MoneyPrecisionError('Money.fromMinor: numeric amount must be an integer', { amount });
  }
  if (!Number.isSafeInteger(amount)) {
    throw new MoneyPrecisionError(
      'Money.fromMinor: amount exceeds safe integer range; pass a bigint',
      { amount },
    );
  }
  return BigInt(amount);
}

/** Parse a decimal string into an exact `numerator / denominator` fraction. */
function parseDecimal(value: string): { numerator: bigint; denominator: bigint } {
  const trimmed = value.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    throw new MoneyPrecisionError(`Invalid decimal value: "${value}"`, { value });
  }
  const negative = trimmed.startsWith('-');
  const [intPart, fracPart = ''] = trimmed.replace(/^[+-]/, '').split('.');
  const numerator = BigInt(`${intPart}${fracPart}`) * (negative ? -1n : 1n);
  const denominator = 10n ** BigInt(fracPart.length);
  return { numerator, denominator };
}

/** Convert a scalar factor into an exact fraction. */
function factorToFraction(factor: MoneyFactor): { numerator: bigint; denominator: bigint } {
  if (typeof factor === 'bigint') return { numerator: factor, denominator: 1n };
  if (typeof factor === 'number') {
    if (!Number.isFinite(factor)) {
      throw new MoneyPrecisionError('multiply: factor must be finite', { factor });
    }
    if (Number.isInteger(factor)) return { numerator: BigInt(factor), denominator: 1n };
    const asString = factor.toString();
    if (asString.includes('e') || asString.includes('E')) {
      throw new MoneyPrecisionError(
        'multiply: pass fractional factors as decimal strings for exactness',
        { factor },
      );
    }
    return parseDecimal(asString);
  }
  return parseDecimal(factor);
}
