import type { SessionResponseDto } from '@fides/contracts';
import type { IssuedSession } from '../application/session.service';

/**
 * Serialize an issued session onto the wire contract (dates as ISO strings).
 *
 * `includeTokens` is false for cookie transport (ADR-0027): the tokens travel
 * as httpOnly cookies, and echoing them in the body as well would hand them
 * straight back to script and defeat the point of the mode.
 */
export function toSessionDto(session: IssuedSession, includeTokens = true): SessionResponseDto {
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    deviceId: session.deviceId,
    ...(includeTokens
      ? { accessToken: session.accessToken, refreshToken: session.refreshToken }
      : {}),
    accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
    refreshExpiresAt: session.refreshExpiresAt.toISOString(),
    absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
  };
}
