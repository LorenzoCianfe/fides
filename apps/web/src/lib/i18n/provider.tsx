'use client';

import { DEFAULT_LOCALE, interpolate, MESSAGES, type Locale, type MessageKey } from '@fides/i18n';
import * as React from 'react';

/**
 * The React binding for the shared catalogue (`@fides/i18n`). The catalogue and
 * the formatting are shared with mobile; only this binding is web-specific,
 * because the two platforms differ in how they render, not in what they say.
 */
interface I18nValue {
  locale: Locale;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}

const I18nContext = React.createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}): React.JSX.Element {
  const value = React.useMemo<I18nValue>(() => {
    const catalogue = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
    return {
      locale,
      t: (key, values) => interpolate(catalogue[key] ?? key, values),
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = React.useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside an I18nProvider');
  return value;
}

/** Convenience: the translate function alone, which is what most components want. */
export function useTranslations(): I18nValue['t'] {
  return useI18n().t;
}
