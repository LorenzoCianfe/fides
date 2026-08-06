/**
 * Carries the one-time enrolment credential from email verification to passkey
 * creation.
 *
 * It travels in `sessionStorage` rather than in the URL. The token authorizes
 * creating the first passkey on an account — the credential that then grants
 * access to it — and a query string is the wrong place for one: it is written
 * into browser history, sits in the address bar through screen shares and
 * screenshots, is copied whenever the user shares the link, and reaches any
 * proxy or access log along the way. `sessionStorage` is same-origin and scoped
 * to the one tab, and it disappears when that tab closes.
 *
 * The read is deliberately non-destructive: a passkey ceremony the user
 * cancels, or a page reload part-way through, should not cost them a fresh
 * round of email verification. The token is single-use and short-lived
 * server-side, and this clears it as soon as it has been spent.
 */

const STORAGE_KEY = 'fides.enrolment';

export interface EnrolmentHandoff {
  userId: string;
  enrolmentToken: string;
}

function isHandoff(value: unknown): value is EnrolmentHandoff {
  if (typeof value !== 'object' || value === null) return false;
  const { userId, enrolmentToken } = value as Record<string, unknown>;
  return (
    typeof userId === 'string' &&
    userId.length > 0 &&
    typeof enrolmentToken === 'string' &&
    enrolmentToken.length > 0
  );
}

export function stashEnrolment(handoff: EnrolmentHandoff): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(handoff));
  } catch {
    // Storage can be unavailable or full (private browsing, quota, disabled
    // cookies). Failing here would strand the user mid-signup with nothing to
    // act on; the next step reports the missing handoff instead.
  }
}

/** The pending handoff, or null if there is none to act on. */
export function readEnrolment(): EnrolmentHandoff | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isHandoff(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Drop the handoff once the passkey it authorizes actually exists. */
export function clearEnrolment(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing useful to do: the token is single-use server-side regardless.
  }
}
