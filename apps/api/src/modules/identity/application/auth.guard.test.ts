import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ACCESS_COOKIE, CSRF_HEADER, hashCsrfToken } from '../http/token-transport';
import { extractBearerToken, SessionAuthGuard, type AuthenticatedRequest } from './auth.guard';
import { assertResourceOwnership } from './authorization';
import type { Principal, SessionService } from './session.service';

const principal: Principal = {
  userId: 'user-1',
  sessionId: 'session-1',
  deviceId: 'device-1',
  userStatus: 'active',
  csrfTokenHash: null,
};

const CSRF_TOKEN = 'fcs_a-real-looking-token';
const cookiePrincipal: Principal = { ...principal, csrfTokenHash: hashCsrfToken(CSRF_TOKEN) };

function guardFor(resolved: Principal): SessionAuthGuard {
  const validateAccessToken = vi.fn().mockResolvedValue(resolved);
  return new SessionAuthGuard({ validateAccessToken } as unknown as SessionService);
}

function cookieRequest(method: string, headers: Record<string, string> = {}): AuthenticatedRequest {
  return {
    method,
    headers: { cookie: `${ACCESS_COOKIE}=fat_abc`, ...headers },
  } as unknown as AuthenticatedRequest;
}

function contextFor(request: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('extractBearerToken', () => {
  it('extracts the token from a well-formed header', () => {
    expect(extractBearerToken('Bearer fat_abc')).toBe('fat_abc');
    expect(extractBearerToken('bearer fat_abc')).toBe('fat_abc');
  });

  it.each([undefined, '', 'fat_abc', 'Basic dXNlcg==', 'Bearer', 'Bearer a b'])(
    'rejects a missing or malformed header (%j)',
    (header) => {
      expect(() => extractBearerToken(header as string | undefined)).toThrowError(
        expect.objectContaining({ code: 'UNAUTHENTICATED' }),
      );
    },
  );
});

describe('SessionAuthGuard', () => {
  it('validates the bearer token and attaches the principal', async () => {
    const validateAccessToken = vi.fn().mockResolvedValue(principal);
    const guard = new SessionAuthGuard({ validateAccessToken } as unknown as SessionService);
    const request = { headers: { authorization: 'Bearer fat_abc' } } as AuthenticatedRequest;

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(validateAccessToken).toHaveBeenCalledWith('fat_abc');
    expect(request.principal).toEqual(principal);
  });

  it('rejects a request presenting neither a header nor a cookie', async () => {
    const guard = new SessionAuthGuard({} as SessionService);
    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  describe('cookie transport (ADR-0027)', () => {
    it('falls back to the access cookie and records the transport', async () => {
      const guard = guardFor(cookiePrincipal);
      const request = cookieRequest('GET');

      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
      expect(request.principal).toEqual(cookiePrincipal);
      expect(request.authTransport).toBe('cookie');
    });

    it('prefers the bearer header when both are presented', async () => {
      const validateAccessToken = vi.fn().mockResolvedValue(principal);
      const guard = new SessionAuthGuard({ validateAccessToken } as unknown as SessionService);
      const request = {
        method: 'GET',
        headers: { authorization: 'Bearer fat_header', cookie: `${ACCESS_COOKIE}=fat_cookie` },
      } as unknown as AuthenticatedRequest;

      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
      expect(validateAccessToken).toHaveBeenCalledWith('fat_header');
      expect(request.authTransport).toBe('bearer');
    });

    it('does not fall through to the cookie when the bearer header is malformed', async () => {
      const guard = guardFor(cookiePrincipal);
      const request = {
        method: 'GET',
        headers: { authorization: 'Basic dXNlcg==', cookie: `${ACCESS_COOKIE}=fat_cookie` },
      } as unknown as AuthenticatedRequest;

      await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('accepts a state-changing request carrying a matching CSRF token', async () => {
      const guard = guardFor(cookiePrincipal);
      const request = cookieRequest('POST', { [CSRF_HEADER]: CSRF_TOKEN });

      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
      'rejects a %s with no CSRF token',
      async (method) => {
        const guard = guardFor(cookiePrincipal);

        await expect(guard.canActivate(contextFor(cookieRequest(method)))).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
      },
    );

    it('rejects a state-changing request whose CSRF token does not match', async () => {
      const guard = guardFor(cookiePrincipal);
      const request = cookieRequest('POST', { [CSRF_HEADER]: 'fcs_not-the-right-token' });

      await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('rejects a state-changing cookie request for a session that has no CSRF token', async () => {
      // A session issued in bearer mode carries no hash, so it can never be
      // driven from a cookie: the check fails closed rather than opting out.
      const guard = guardFor(principal);
      const request = cookieRequest('POST', { [CSRF_HEADER]: CSRF_TOKEN });

      await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('does not require a CSRF token on safe methods', async () => {
      const guard = guardFor(cookiePrincipal);

      for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        await expect(guard.canActivate(contextFor(cookieRequest(method)))).resolves.toBe(true);
      }
    });

    it('leaves bearer callers exempt from the CSRF check', async () => {
      const guard = guardFor(cookiePrincipal);
      const request = {
        method: 'POST',
        headers: { authorization: 'Bearer fat_abc' },
      } as unknown as AuthenticatedRequest;

      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    });
  });
});

describe('assertResourceOwnership', () => {
  it('passes when the principal owns the resource', () => {
    expect(() => assertResourceOwnership(principal, 'user-1')).not.toThrow();
  });

  it('throws FORBIDDEN when the resource belongs to someone else', () => {
    expect(() => assertResourceOwnership(principal, 'user-2')).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });
});
