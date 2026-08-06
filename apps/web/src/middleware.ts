import { LOCALES, negotiateLocale, parseAcceptLanguage } from '@fides/i18n';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Locale routing. Every page lives under `/{locale}`, so a request without one
 * is redirected to the best match.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const hasLocale = LOCALES.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
  if (hasLocale) return NextResponse.next();

  const preferences = parseAcceptLanguage(request.headers.get('accept-language') ?? '');
  const url = request.nextUrl.clone();
  url.pathname = `/${negotiateLocale(preferences)}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals and anything with a file extension, so static assets
  // are not redirected into a locale that does not serve them.
  matcher: ['/((?!_next|api|.*\\..*).*)'],
};
