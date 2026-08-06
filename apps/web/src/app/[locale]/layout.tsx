import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { I18nProvider } from '../../lib/i18n/provider';
import { isLocale, LOCALES } from '../../lib/i18n/messages';
import '../globals.css';

const appName = process.env.APP_NAME ?? 'Fides';

export const metadata: Metadata = {
  title: `${appName} — Banking, made clear`,
  description: 'Simulated-core EU neobank. Customer web application.',
};

/**
 * The locale segment carries the root layout: with every route nested under it,
 * `<html lang>` can reflect the actual locale instead of being hard-coded.
 */
export function generateStaticParams(): Array<{ locale: string }> {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // An unknown locale is a 404, not a silent fallback: quietly serving English
  // at /fr would leave a broken link looking like a working one.
  if (!isLocale(locale)) notFound();

  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
