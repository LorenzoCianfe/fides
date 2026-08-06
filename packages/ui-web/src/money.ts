/** A monetary amount on the wire: integer minor units as a bigint-safe string. */
export interface MoneyLike {
  readonly amount: string;
  readonly currency: string;
}

/**
 * How many fraction digits a currency renders with, asked of the platform
 * rather than hard-coded, so zero-decimal currencies (JPY) and three-decimal
 * ones (BHD) come out right without a table to maintain.
 */
function fractionDigitsFor(currency: string, locale: string): number {
  try {
    return (
      new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/**
 * Format integer minor units for display.
 *
 * Deliberately never converts through `Number`. Minor units are bigint-safe
 * strings on the wire precisely because a balance can exceed
 * `Number.MAX_SAFE_INTEGER`, and silently rounding someone's balance in the UI
 * is not an acceptable failure mode. The split into whole and fractional parts
 * is exact `BigInt` arithmetic, and the decimal string is handed to `Intl`,
 * whose `format` accepts a string for exactly this reason.
 */
export function formatMoney(money: MoneyLike, locale = 'en'): string {
  const digits = fractionDigitsFor(money.currency, locale);

  let minor: bigint;
  try {
    minor = BigInt(money.amount);
  } catch {
    // An unparseable amount is a contract violation, not a display concern:
    // show it verbatim rather than inventing a number.
    return `${money.amount} ${money.currency}`;
  }

  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const divisor = 10n ** BigInt(digits);
  const whole = absolute / divisor;
  const fraction = absolute % divisor;

  const decimal =
    digits === 0 ? whole.toString() : `${whole}.${fraction.toString().padStart(digits, '0')}`;

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

  return (formatter as unknown as DecimalStringFormatter).format(
    `${negative ? '-' : ''}${decimal}`,
  );
}

/**
 * `Intl.NumberFormat.prototype.format` accepts a decimal string as of
 * Intl.NumberFormat V3 (ES2023) — which is the only way to format a value
 * beyond `Number.MAX_SAFE_INTEGER` without losing digits. TypeScript's ES2022
 * lib still declares only `number | bigint`, so the capability is named here
 * rather than asserted anonymously at the call site. Supported by Node 18+,
 * Chrome 106+, Safari 15.4+, and Firefox 116+; covered by a precision test.
 */
interface DecimalStringFormatter {
  format(value: string): string;
}

/** The sign of a wire amount, determined without parsing it into a number. */
export function moneyDirection(money: MoneyLike): 'positive' | 'negative' | 'zero' {
  const trimmed = money.amount.trim();
  if (trimmed.startsWith('-')) return 'negative';
  return /^0+$/.test(trimmed) ? 'zero' : 'positive';
}

/**
 * Parse a locale-agnostic major-unit input ("12.34") into minor units for the
 * wire. Returns null for anything that is not a clean amount, so the caller can
 * show a validation message rather than send a guess to the ledger.
 */
export function parseAmountToMinor(input: string, currency: string, locale = 'en'): string | null {
  const trimmed = input.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;

  const digits = fractionDigitsFor(currency, locale);
  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > digits) return null;

  const padded = fraction.padEnd(digits, '0');
  const minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt(padded === '' ? '0' : padded);
  return minor.toString();
}
