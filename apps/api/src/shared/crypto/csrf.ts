import { timingSafeEqual } from 'node:crypto';
import { generateToken, sha256Hex } from './secrets';

/**
 * CSRF tokens for the cookie transport mode (ADR-0027).
 *
 * Lives beside the other secret primitives rather than in the HTTP layer so
 * the session service can verify a token inside its own transaction without
 * depending upwards on a controller module.
 */

export const CSRF_TOKEN_PREFIX = 'fcs';

/**
 * A fresh CSRF token. Random rather than derived from a server secret, so it
 * can be stored as a hash beside the session's other secrets and is revoked
 * with the session by construction — no signing key to configure or rotate.
 */
export function generateCsrfToken(): string {
  return generateToken(CSRF_TOKEN_PREFIX);
}

export function hashCsrfToken(token: string): string {
  return sha256Hex(token);
}

/**
 * Constant-time comparison of a presented CSRF token against its stored hash.
 * A session with no stored hash never matches: a session issued in bearer mode
 * cannot be driven from a cookie, so the check fails closed.
 */
export function csrfTokenMatches(
  presented: string | undefined,
  storedHash: string | null,
): boolean {
  if (!presented || !storedHash) return false;
  const presentedHash = Buffer.from(hashCsrfToken(presented), 'utf8');
  const stored = Buffer.from(storedHash, 'utf8');
  // Hex SHA-256 is fixed width, but a malformed stored value must not throw.
  return presentedHash.length === stored.length && timingSafeEqual(presentedHash, stored);
}
