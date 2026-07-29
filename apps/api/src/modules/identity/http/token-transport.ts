import type { CookieOptions, Request, Response } from 'express';
import { readCookie } from '../../../shared/http/cookies';

// Re-exported so the HTTP layer has a single import for everything transport.
export {
  CSRF_TOKEN_PREFIX,
  csrfTokenMatches,
  generateCsrfToken,
  hashCsrfToken,
} from '../../../shared/crypto/csrf';

/**
 * Token transport negotiation (ADR-0027).
 *
 * Phase 1 shipped body-only tokens with an `Authorization: Bearer` header
 * (ADR-0021). Slice 8 adds an *opt-in* cookie mode for the browser client:
 * the client asks for it per request, and only the responses that mint a
 * session behave differently. Mobile, and every existing test, never send the
 * header and see byte-identical behaviour.
 */

/** Opt-in request header. Any value other than `cookie` means body transport. */
export const TOKEN_TRANSPORT_HEADER = 'x-fides-token-transport';
/** Double-submit header echoing the readable CSRF cookie. */
export const CSRF_HEADER = 'x-csrf-token';

export const ACCESS_COOKIE = 'fides_at';
export const REFRESH_COOKIE = 'fides_rt';
export const CSRF_COOKIE = 'fides_csrf';

/** The access and CSRF cookies travel with every API call. */
export const API_COOKIE_PATH = '/v1';
/**
 * The refresh cookie is scoped to the one route that consumes it, so the
 * longest-lived credential is absent from ordinary requests.
 */
export const REFRESH_COOKIE_PATH = '/v1/auth/refresh';

export type TokenTransport = 'body' | 'cookie';

/** How cookies are attributed; driven by config because TLS is deployment-dependent. */
export interface CookieTransportConfig {
  /** `Secure` attribute. Off only for plain-HTTP local development. */
  secure: boolean;
  /**
   * `SameSite`. `strict` is the default and requires the web client and the API
   * to be same-site (different ports or subdomains are fine; different
   * registrable domains are not). A cross-site deployment needs `none`, which
   * mandates `secure` and leans entirely on the CSRF token below.
   */
  sameSite: 'strict' | 'lax' | 'none';
}

/** Which transport the caller asked for. Absent or unrecognized means body. */
export function resolveTokenTransport(request: Request): TokenTransport {
  const raw = request.headers[TOKEN_TRANSPORT_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim().toLowerCase() === 'cookie' ? 'cookie' : 'body';
}

export function readAccessCookie(request: Request): string | undefined {
  return readCookie(request.headers.cookie, ACCESS_COOKIE);
}

export function readRefreshCookie(request: Request): string | undefined {
  return readCookie(request.headers.cookie, REFRESH_COOKIE);
}

export function readCsrfHeader(request: Request): string | undefined {
  const raw = request.headers[CSRF_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

/** Methods that cannot change state, and so need no CSRF token. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

interface SessionCookiePayload {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshExpiresAt: Date;
}

/**
 * Write the session onto cookies. The token pair is `httpOnly` so script cannot
 * read it; the CSRF token deliberately is not, because the client must echo it
 * back in a header for the double-submit check to mean anything.
 */
export function setSessionCookies(
  response: Response,
  session: SessionCookiePayload,
  csrfToken: string,
  config: CookieTransportConfig,
  now: Date,
): void {
  const base: CookieOptions = {
    secure: config.secure,
    sameSite: config.sameSite,
    httpOnly: true,
  };
  const accessMaxAge = millisecondsUntil(session.accessTokenExpiresAt, now);
  const refreshMaxAge = millisecondsUntil(session.refreshExpiresAt, now);

  response.cookie(ACCESS_COOKIE, session.accessToken, {
    ...base,
    path: API_COOKIE_PATH,
    maxAge: accessMaxAge,
  });
  response.cookie(REFRESH_COOKIE, session.refreshToken, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    maxAge: refreshMaxAge,
  });
  response.cookie(CSRF_COOKIE, csrfToken, {
    ...base,
    httpOnly: false,
    path: API_COOKIE_PATH,
    maxAge: refreshMaxAge,
  });
}

/**
 * Clear every session cookie. The attributes must match those they were set
 * with — a mismatched `path` leaves the original cookie in place — so this
 * mirrors `setSessionCookies` exactly.
 */
export function clearSessionCookies(response: Response, config: CookieTransportConfig): void {
  const base: CookieOptions = {
    secure: config.secure,
    sameSite: config.sameSite,
    httpOnly: true,
  };

  response.clearCookie(ACCESS_COOKIE, { ...base, path: API_COOKIE_PATH });
  response.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_COOKIE_PATH });
  response.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false, path: API_COOKIE_PATH });
}

/**
 * Cookie lifetimes track the token deadlines, floored at zero: a clock skew
 * that puts the deadline in the past must expire the cookie, never revive it
 * as a session cookie by emitting a negative `Max-Age`.
 */
function millisecondsUntil(deadline: Date, now: Date): number {
  return Math.max(0, deadline.getTime() - now.getTime());
}
