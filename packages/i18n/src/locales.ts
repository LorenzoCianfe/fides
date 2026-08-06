export const LOCALES = ['en', 'it'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Pick the best supported locale from an `Accept-Language` header or an
 * ordered list of platform preferences. A plain scan rather than a matching
 * library: with two locales the library would be more code than the problem.
 */
export function negotiateLocale(preferences: readonly string[]): Locale {
  for (const preference of preferences) {
    // `it-IT` should match the `it` catalogue.
    const base = preference.trim().toLowerCase().split('-')[0] ?? '';
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** Parse an `Accept-Language` header into tags ordered by descending quality. */
export function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map((entry) => {
      const [tag = '', ...params] = entry.trim().split(';');
      const quality = params.find((param) => param.trim().startsWith('q='));
      return {
        tag: tag.trim(),
        quality: quality ? Number.parseFloat(quality.split('=')[1] ?? '0') : 1,
      };
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.quality - a.quality)
    .map((entry) => entry.tag);
}
