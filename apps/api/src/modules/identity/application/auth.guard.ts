import { AuthenticationError } from '@fides/domain';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Principal, SessionService } from './session.service';

/** A request carrying the guard-attached authenticated principal. */
export interface AuthenticatedRequest extends Request {
  principal?: Principal;
}

/** Extract the opaque token from an `Authorization: Bearer …` header. */
export function extractBearerToken(header: string | undefined): string {
  if (!header) throw new AuthenticationError('Missing Authorization header');
  const parts = header.split(' ');
  const [scheme, token] = parts;
  if (parts.length !== 2 || scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new AuthenticationError('Malformed Authorization header');
  }
  return token;
}

/**
 * Session-backed authentication guard. Validates the bearer token against the
 * session row (immediate revocation, suspended users cut off) and attaches the
 * principal to the request. Registered via DI in Wave C; headless-testable.
 */
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    request.principal = await this.sessions.validateAccessToken(token);
    return true;
  }
}
