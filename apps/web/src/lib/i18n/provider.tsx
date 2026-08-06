'use client';

import * as React from 'react';
import { DEFAULT_LOCALE, MESSAGES, type Locale, type MessageKey } from './messages';

interface I18nValue {
  locale: Locale;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}

const I18nContext = React.createContext<I18nValue | null>(null);

/**
 * Interpolate `{name}` placeholders. Deliberately not a full ICU implementation:
 * the catalogue currently needs substitution only, and pretending to support
 * plurals we do not handle would be worse than not offering them.
 */
function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

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
