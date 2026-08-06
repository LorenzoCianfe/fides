import type { MessageKey } from '@fides/i18n';
import { ApiError } from './api/client';

/**
 * Where the failure happened. A bare error code is not enough to phrase a good
 * message: `NOT_FOUND` means "no such payee" on the transfer route and
 * something quite different elsewhere, so the caller says which it is rather
 * than the mapper guessing.
 */
export type ErrorContext = 'transfer' | 'signin' | 'generic';

/**
 * Map a failure to a message the user can act on.
 *
 * Deliberately narrow: only failures with a genuinely more useful phrasing get
 * a specific message. Everything else falls back to the generic one rather than
 * echoing a server message that may leak internals or read as gibberish. The
 * correlation id is surfaced separately so support can find the request.
 */
export function messageKeyForError(error: unknown, context: ErrorContext = 'generic'): MessageKey {
  // A cancelled passkey prompt is a user choice, not a failure, and is the same
  // in every context — so it is checked before anything else.
  if (isPasskeyCancellation(error)) return 'error.passkeyCancelled';

  if (error instanceof ApiError) {
    if (context === 'transfer') {
      switch (error.code) {
        case 'INSUFFICIENT_FUNDS':
          return 'error.insufficientFunds';
        case 'NOT_FOUND':
          return 'error.recipientUnknown';
        case 'VALIDATION_FAILED':
          return 'error.amountInvalid';
        default:
          return 'error.generic';
      }
    }
    if (context === 'signin') {
      // The API answers unknown and wrong-credential alike on purpose
      // (anti-enumeration, ADR-0020); the message must not distinguish them.
      return error.category === 'authentication' ? 'error.signInFailed' : 'error.generic';
    }
    return 'error.generic';
  }

  // fetch() rejects with TypeError when it never reached the server.
  if (error instanceof TypeError) return 'error.network';
  return 'error.generic';
}

/**
 * WebAuthn reports a cancelled or timed-out ceremony as `NotAllowedError`.
 * That is a user choice, not a fault, and must not read as an error.
 */
function isPasskeyCancellation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'NotAllowedError'
  );
}

/** The correlation id, when the failure carries one worth showing to support. */
export function correlationIdOf(error: unknown): string | undefined {
  return error instanceof ApiError ? error.correlationId : undefined;
}
