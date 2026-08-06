import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE, LOCALES } from './lib/i18n/messages';

/**
 * Locale routing. Every page lives under `/{locale}`, so a request without one
 * is redirected to the best match. Negotiation is a plain `Accept-Language`
 * scan rather than a matching library — with two locales the library would be
 * more code than the problem.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const hasLocale = LOCALES.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
  if (hasLocale) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/${preferredLocale(request)}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url);
}

function preferredLocale(request: NextRequest): string {
  const header = request.headers.get('accept-language') ?? '';
  const accepted = header
    .split(',')
    .map((entry) => {
      const [tag = '', ...params] = entry.trim().split(';');
      const quality = params.find((param) => param.trim().startsWith('q='));
      return {
        // `it-IT` should match the `it` catalogue.
        base: tag.trim().toLowerCase().split('-')[0] ?? '',
        quality: quality ? Number.parseFloat(quality.split('=')[1] ?? '0') : 1,
      };
    })
    .filter((entry) => entry.base.length > 0)
    .sort((a, b) => b.quality - a.quality);

  const match = accepted.find((entry) => (LOCALES as readonly string[]).includes(entry.base));
  return match?.base ?? DEFAULT_LOCALE;
}

export const config = {
  // Skip Next internals and anything with a file extension, so static assets
  // are not redirected into a locale that does not serve them.
  matcher: ['/((?!_next|api|.*\\..*).*)'],
};
