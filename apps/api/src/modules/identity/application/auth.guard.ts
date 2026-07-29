import { AuthenticationError, AuthorizationError } from '@fides/domain';
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import {
  csrfTokenMatches,
  isSafeMethod,
  readAccessCookie,
  readCsrfHeader,
} from '../http/token-transport';
import { SessionService, type Principal } from './session.service';

/** How the caller presented their session (ADR-0027). */
export type AuthTransport = 'bearer' | 'cookie';

/** A request carrying the guard-attached authenticated principal. */
export interface AuthenticatedRequest extends Request {
  principal?: Principal;
  /** Set by the guard so handlers can mirror the caller's transport. */
  authTransport?: AuthTransport;
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
 * Session-backed authentication guard. Validates the presented token against
 * the session row (immediate revocation, suspended users cut off) and attaches
 * the principal to the request. `@UseGuards` instantiates it as an enhancer, so
 * it carries an explicit injection token; it stays headless-testable.
 *
 * Two transports are accepted (ADR-0027). `Authorization: Bearer` is tried
 * first and wins whenever the header is present, so mobile and every existing
 * caller are unaffected; only a request with no such header falls back to the
 * access cookie. A malformed bearer is still rejected rather than silently
 * falling through to the cookie — presenting a credential badly is an error,
 * not an invitation to try another one.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { token, transport } = this.resolveToken(request);
    const principal = await this.sessions.validateAccessToken(token);

    // A cookie rides along automatically, so a state-changing request needs
    // separate proof that the caller's own script issued it. A bearer token is
    // never sent ambiently, so it carries that proof by construction.
    if (transport === 'cookie' && !isSafeMethod(request.method)) {
      if (!csrfTokenMatches(readCsrfHeader(request), principal.csrfTokenHash)) {
        throw new AuthorizationError('Missing or invalid CSRF token');
      }
    }

    request.principal = principal;
    request.authTransport = transport;
    return true;
  }

  private resolveToken(request: Request): { token: string; transport: AuthTransport } {
    if (request.headers.authorization) {
      return { token: extractBearerToken(request.headers.authorization), transport: 'bearer' };
    }
    const cookie = readAccessCookie(request);
    if (!cookie) throw new AuthenticationError('Missing Authorization header');
    return { token: cookie, transport: 'cookie' };
  }
}
