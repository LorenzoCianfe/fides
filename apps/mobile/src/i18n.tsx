import {
  DEFAULT_LOCALE,
  interpolate,
  MESSAGES,
  negotiateLocale,
  type Locale,
  type MessageKey,
} from '@fides/i18n';
import * as React from 'react';
import { NativeModules, Platform } from 'react-native';

/**
 * The React Native binding for the shared catalogue (`@fides/i18n`). The
 * catalogue and the money formatting are shared with web; only this binding is
 * platform-specific.
 */
interface I18nValue {
  locale: Locale;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}

const I18nContext = React.createContext<I18nValue | null>(null);

/**
 * The device's preferred language, read without `expo-localization` — one more
 * native module for a value both platforms already expose. Anything unexpected
 * falls through to the default rather than throwing: a wrong language is a
 * cosmetic problem, a crash on startup is not.
 */
function devicePreferences(): string[] {
  try {
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings as
        { AppleLanguages?: string[]; AppleLocale?: string } | undefined;
      return settings?.AppleLanguages ?? (settings?.AppleLocale ? [settings.AppleLocale] : []);
    }
    const identifier = NativeModules.I18nManager?.localeIdentifier as string | undefined;
    return identifier ? [identifier.replace('_', '-')] : [];
  } catch {
    return [];
  }
}

export function I18nProvider({
  children,
  locale,
}: {
  children: React.ReactNode;
  /** Pins the locale; otherwise it is negotiated from device settings. */
  locale?: Locale;
}): React.JSX.Element {
  const value = React.useMemo<I18nValue>(() => {
    const resolved = locale ?? negotiateLocale(devicePreferences());
    const catalogue = MESSAGES[resolved] ?? MESSAGES[DEFAULT_LOCALE];
    return {
      locale: resolved,
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

/** Convenience: the translate function alone, which is what most screens want. */
export function useTranslations(): I18nValue['t'] {
  return useI18n().t;
}
