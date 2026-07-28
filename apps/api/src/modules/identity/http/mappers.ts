import type { SessionResponseDto } from '@fides/contracts';
import type { IssuedSession } from '../application/session.service';

/** Serialize an issued session onto the wire contract (dates as ISO strings). */
export function toSessionDto(session: IssuedSession): SessionResponseDto {
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    deviceId: session.deviceId,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
    refreshExpiresAt: session.refreshExpiresAt.toISOString(),
    absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
  };
}
