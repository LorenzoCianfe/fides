import { AuthorizationError, type ErrorContext } from '@fides/domain';
import type { Principal } from './session.service';

/**
 * Object-level authorization: the authenticated principal must own the
 * resource. Every resource handler resolves the owner server-side and asserts
 * it here — client-supplied identifiers are never trusted implicitly
 * (security.md §3.1).
 */
export function assertResourceOwnership(
  principal: Principal,
  resourceOwnerUserId: string,
  details?: ErrorContext,
): void {
  if (principal.userId !== resourceOwnerUserId) {
    throw new AuthorizationError('Access to this resource is denied', details);
  }
}
