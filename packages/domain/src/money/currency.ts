/**
 * Currency registry.
 *
 * The set of currencies the platform supports, keyed by ISO 4217 alpha code.
 * Each definition carries the minor-unit exponent (e.g. EUR = 2, JPY = 0) that
 * the `Money` value object uses to convert between major and minor units.
 *
 * EUR is the platform base currency. The registry is intentionally small and
 * explicit; new currencies are added here as multi-currency support expands.
 */

export type CurrencyCode = 'EUR' | 'USD' | 'GBP' | 'CHF' | 'SEK' | 'NOK' | 'DKK' | 'PLN' | 'JPY';

export interface CurrencyDefinition {
  /** ISO 4217 alphabetic code. */
  readonly code: CurrencyCode;
  /** ISO 4217 numeric code. */
  readonly numericCode: number;
  /** Number of decimal places (minor-unit exponent). */
  readonly minorUnits: number;
  /** Display symbol. */
  readonly symbol: string;
  /** Human-readable name. */
  readonly name: string;
}

/** The platform base currency. */
export const BASE_CURRENCY: CurrencyCode = 'EUR';

export const CURRENCIES: Readonly<Record<CurrencyCode, CurrencyDefinition>> = Object.freeze({
  EUR: { code: 'EUR', numericCode: 978, minorUnits: 2, symbol: '€', name: 'Euro' },
  USD: { code: 'USD', numericCode: 840, minorUnits: 2, symbol: '$', name: 'US Dollar' },
  GBP: { code: 'GBP', numericCode: 826, minorUnits: 2, symbol: '£', name: 'Pound Sterling' },
  CHF: { code: 'CHF', numericCode: 756, minorUnits: 2, symbol: 'Fr', name: 'Swiss Franc' },
  SEK: { code: 'SEK', numericCode: 752, minorUnits: 2, symbol: 'kr', name: 'Swedish Krona' },
  NOK: { code: 'NOK', numericCode: 578, minorUnits: 2, symbol: 'kr', name: 'Norwegian Krone' },
  DKK: { code: 'DKK', numericCode: 208, minorUnits: 2, symbol: 'kr', name: 'Danish Krone' },
  PLN: { code: 'PLN', numericCode: 985, minorUnits: 2, symbol: 'zł', name: 'Polish Złoty' },
  JPY: { code: 'JPY', numericCode: 392, minorUnits: 0, symbol: '¥', name: 'Japanese Yen' },
});

/** Narrowing guard: is the given string a supported currency code? */
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

/**
 * Look up a currency definition.
 *
 * @throws {RangeError} if the code is not in the registry.
 */
export function getCurrency(code: CurrencyCode): CurrencyDefinition {
  const definition = CURRENCIES[code];
  if (definition === undefined) {
    throw new RangeError(`getCurrency: unsupported currency code ${String(code)}`);
  }
  return definition;
}

/** All supported currency definitions. */
export function listCurrencies(): CurrencyDefinition[] {
  return Object.values(CURRENCIES);
}
