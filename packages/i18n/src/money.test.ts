import { describe, expect, it } from 'vitest';
import { formatMoney, moneyDirection, parseAmountToMinor } from './money';

/**
 * Intl separates the amount from its currency symbol with a non-breaking or
 * narrow-no-break space depending on locale; normalize both to a plain space
 * so the assertions below read literally. Written as escapes because the raw
 * characters are invisible in source.
 */
const normalize = (value: string): string => value.replace(/[\u00A0\u202F]/g, ' ');

describe('formatMoney', () => {
  it('renders minor units as a major-unit currency amount', () => {
    expect(normalize(formatMoney({ amount: '1050', currency: 'EUR' }, 'en-IE'))).toBe('€10.50');
    expect(normalize(formatMoney({ amount: '0', currency: 'EUR' }, 'en-IE'))).toBe('€0.00');
    expect(normalize(formatMoney({ amount: '7', currency: 'EUR' }, 'en-IE'))).toBe('€0.07');
  });

  it('renders negative amounts', () => {
    expect(normalize(formatMoney({ amount: '-2500', currency: 'EUR' }, 'en-IE'))).toBe('-€25.00');
  });

  it('follows the locale for separators and symbol placement', () => {
    expect(normalize(formatMoney({ amount: '1234556', currency: 'EUR' }, 'it-IT'))).toBe(
      '12.345,56 €',
    );
    expect(normalize(formatMoney({ amount: '1234556', currency: 'EUR' }, 'en-IE'))).toBe(
      '€12,345.56',
    );
  });

  it('leaves four-digit Italian amounts ungrouped, as ICU requires', () => {
    // Italian (like Spanish and Portuguese) uses min2 grouping: no separator
    // until there are two digits before the group. Pinned so this does not get
    // "corrected" to 1.234,56, which would be wrong for the locale.
    expect(normalize(formatMoney({ amount: '123456', currency: 'EUR' }, 'it-IT'))).toBe(
      '1234,56 €',
    );
  });

  it('never loses precision on amounts beyond Number.MAX_SAFE_INTEGER', () => {
    // 90071992547409910 minor units = 900719925474099.10 major. Going through
    // Number here would round the balance; the whole point is that it does not.
    const formatted = normalize(
      formatMoney({ amount: '90071992547409910', currency: 'EUR' }, 'en-IE'),
    );

    expect(formatted).toContain('900,719,925,474,099.10');
    expect(formatted).not.toContain('900,719,925,474,099.12');
  });

  it('respects a currency exponent that is not two', () => {
    // JPY has no minor unit at all, so the value is already major.
    expect(normalize(formatMoney({ amount: '1050', currency: 'JPY' }, 'en-US'))).toBe('¥1,050');
  });

  it('shows an unparseable amount verbatim rather than inventing a number', () => {
    expect(formatMoney({ amount: 'not-a-number', currency: 'EUR' }, 'en-IE')).toBe(
      'not-a-number EUR',
    );
  });
});

describe('moneyDirection', () => {
  it('classifies without parsing', () => {
    expect(moneyDirection({ amount: '-1', currency: 'EUR' })).toBe('negative');
    expect(moneyDirection({ amount: '0', currency: 'EUR' })).toBe('zero');
    expect(moneyDirection({ amount: '000', currency: 'EUR' })).toBe('zero');
    expect(moneyDirection({ amount: '1', currency: 'EUR' })).toBe('positive');
  });
});

describe('parseAmountToMinor', () => {
  it('converts major-unit input to minor units', () => {
    expect(parseAmountToMinor('10.50', 'EUR')).toBe('1050');
    expect(parseAmountToMinor('10', 'EUR')).toBe('1000');
    expect(parseAmountToMinor('0.07', 'EUR')).toBe('7');
    expect(parseAmountToMinor('  12.34  ', 'EUR')).toBe('1234');
  });

  it('accepts a comma as the decimal separator', () => {
    expect(parseAmountToMinor('10,50', 'EUR')).toBe('1050');
  });

  it('keeps full precision on very large inputs', () => {
    expect(parseAmountToMinor('900719925474099.10', 'EUR')).toBe('90071992547409910');
  });

  it('rejects more precision than the currency has', () => {
    expect(parseAmountToMinor('10.505', 'EUR')).toBeNull();
    expect(parseAmountToMinor('10.5', 'JPY')).toBeNull();
  });

  it('rejects anything that is not a clean positive amount', () => {
    for (const input of ['', '-5', 'abc', '1.2.3', '1e3', '+5', '10.']) {
      expect(parseAmountToMinor(input, 'EUR')).toBeNull();
    }
  });
});
