import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { extractBearerToken, SessionAuthGuard, type AuthenticatedRequest } from './auth.guard';
import { assertResourceOwnership } from './authorization';
import type { Principal, SessionService } from './session.service';

const principal: Principal = {
  userId: 'user-1',
  sessionId: 'session-1',
  deviceId: 'device-1',
  userStatus: 'active',
};

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

  it('rejects a request without an Authorization header', async () => {
    const guard = new SessionAuthGuard({} as SessionService);
    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
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
