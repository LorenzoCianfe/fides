import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createTestDb, resetDb, type TestDatabase } from '../test/db';
import { CapturingNotifications } from '../test/notifications';
import { SoftwareAuthenticator } from '../test/webauthn';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadEnv } from './config/env';
import {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  REFRESH_COOKIE,
  TOKEN_TRANSPORT_HEADER,
} from './modules/identity/http/token-transport';
import { NOTIFICATIONS } from './shared/tokens';

const ORIGIN = 'http://localhost:3001';
const RP_ID = 'localhost';
const DEVICE = { name: 'Chrome on Windows', platform: 'web' } as const;
const IOS_APP_ID = 'ABCDE12345.local.fides.app';
const ANDROID_PACKAGE = 'local.fides.app';
const ANDROID_FINGERPRINT = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';

const baseInput = {
  givenName: 'Alice',
  familyName: 'Ada',
  dateOfBirth: '1990-05-01',
  addressLine1: '1 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'FR',
};

const notifications = new CapturingNotifications();
const { db, close: closeDb } = createTestDb();

let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;

beforeAll(async () => {
  process.env.DATABASE_URL = inject('databaseUrl');
  process.env.SCHEDULERS_ENABLED = 'false';
  process.env.THROTTLE_ENABLED = 'false';
  // Plain HTTP under supertest: `Secure` cookies would still be *sent* here,
  // but asserting the attribute is clearer with it explicitly off.
  process.env.COOKIE_SECURE = 'false';
  process.env.IOS_APP_ID = IOS_APP_ID;
  process.env.ANDROID_PACKAGE_NAME = ANDROID_PACKAGE;
  process.env.ANDROID_CERT_FINGERPRINTS = ANDROID_FINGERPRINT;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(NOTIFICATIONS)
    .useValue(notifications)
    .compile();

  app = moduleRef.createNestApplication();
  configureApp(app, loadEnv());
  await app.init();
  server = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
  await closeDb();
  delete process.env.COOKIE_SECURE;
  delete process.env.IOS_APP_ID;
  delete process.env.ANDROID_PACKAGE_NAME;
  delete process.env.ANDROID_CERT_FINGERPRINTS;
});

beforeEach(async () => {
  await resetDb(db as TestDatabase);
  notifications.sent.length = 0;
});

function setCookies(response: Response): string[] {
  return (response.headers['set-cookie'] ?? []) as unknown as string[];
}

/** The whole `Set-Cookie` line for `name`, attributes included. */
function rawCookie(response: Response, name: string): string {
  const found = setCookies(response).find((cookie) => cookie.startsWith(`${name}=`));
  if (!found)
    throw new Error(`No Set-Cookie for ${name}; got: ${setCookies(response).join(' | ')}`);
  return found;
}

function cookieValue(response: Response, name: string): string {
  return decodeURIComponent(
    rawCookie(response, name)
      .slice(name.length + 1)
      .split(';')[0]!,
  );
}

function cookieHeader(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

interface CookieSession {
  readonly accessCookie: string;
  readonly refreshCookie: string;
  readonly csrfToken: string;
  readonly authCookies: string;
}

/** The body-transport session payload, where the tokens are always present. */
interface BodySession {
  readonly sessionId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
}

function bodySession(response: Response): BodySession {
  return response.body.session as BodySession;
}

async function onboardAndEnrol(
  email: string,
  transport?: 'cookie',
): Promise<{ response: Response; authenticator: SoftwareAuthenticator }> {
  const registered = await request(server)
    .post('/v1/auth/register')
    .send({ ...baseInput, email })
    .expect(201);
  const code = notifications.sent.at(-1)!.code;
  const verified = await request(server)
    .post('/v1/auth/verify-email')
    .send({ email, code })
    .expect(200);

  const userId = registered.body.userId as string;
  const enrolmentToken = verified.body.enrolmentToken as string;
  const authenticator = new SoftwareAuthenticator();

  const options = await request(server)
    .post('/v1/auth/webauthn/registration/options')
    .send({ userId, enrolmentToken })
    .expect(200);
  const attestation = authenticator.createRegistrationResponse({
    challenge: options.body.challenge as string,
    rpId: RP_ID,
    origin: ORIGIN,
  });

  const verify = request(server)
    .post('/v1/auth/webauthn/registration/verify')
    .send({ userId, enrolmentToken, response: attestation, device: DEVICE });
  if (transport) verify.set(TOKEN_TRANSPORT_HEADER, transport);

  return { response: await verify.expect(201), authenticator };
}

async function cookieSession(email: string): Promise<CookieSession> {
  const { response } = await onboardAndEnrol(email, 'cookie');
  const accessCookie = cookieValue(response, ACCESS_COOKIE);
  const refreshCookie = cookieValue(response, REFRESH_COOKIE);
  const csrfToken = cookieValue(response, CSRF_COOKIE);
  return {
    accessCookie,
    refreshCookie,
    csrfToken,
    authCookies: cookieHeader({ [ACCESS_COOKIE]: accessCookie, [CSRF_COOKIE]: csrfToken }),
  };
}

describe('cookie token transport (integration, ADR-0027)', () => {
  it('sets httpOnly session cookies and withholds the tokens from the body', async () => {
    const { response } = await onboardAndEnrol('cookie-user@example.com', 'cookie');
    const session = response.body.session as Record<string, unknown>;

    // The whole point of the mode: script must not be able to read the tokens.
    expect(session.accessToken).toBeUndefined();
    expect(session.refreshToken).toBeUndefined();
    // Non-secret session metadata still travels normally.
    expect(session.sessionId).toEqual(expect.any(String));
    expect(session.accessTokenExpiresAt).toEqual(expect.any(String));

    expect(cookieValue(response, ACCESS_COOKIE)).toMatch(/^fat_/);
    expect(cookieValue(response, REFRESH_COOKIE)).toMatch(/^frt_/);
    expect(cookieValue(response, CSRF_COOKIE)).toMatch(/^fcs_/);
  });

  it('attributes the cookies so the token pair is unreadable and narrowly scoped', async () => {
    const { response } = await onboardAndEnrol('attrs@example.com', 'cookie');

    const access = rawCookie(response, ACCESS_COOKIE);
    expect(access).toContain('HttpOnly');
    expect(access).toContain('SameSite=Strict');
    expect(access).toContain('Path=/v1');

    // The longest-lived credential is confined to the one route that spends it.
    const refresh = rawCookie(response, REFRESH_COOKIE);
    expect(refresh).toContain('HttpOnly');
    expect(refresh).toContain('Path=/v1/auth/refresh');

    // The CSRF token must be readable, or the client cannot echo it back.
    const csrf = rawCookie(response, CSRF_COOKIE);
    expect(csrf).not.toContain('HttpOnly');
    expect(csrf).toContain('SameSite=Strict');
  });

  it('leaves body transport exactly as it was', async () => {
    const { response } = await onboardAndEnrol('body-user@example.com');
    const session = response.body.session as Record<string, unknown>;

    expect(session.accessToken).toMatch(/^fat_/);
    expect(session.refreshToken).toMatch(/^frt_/);
    expect(setCookies(response)).toHaveLength(0);
  });

  it('authenticates a safe request from the cookie alone, with no Authorization header', async () => {
    const session = await cookieSession('read@example.com');

    const listed = await request(server)
      .get('/v1/auth/sessions')
      .set('Cookie', session.authCookies)
      .expect(200);

    expect(listed.body.sessions).toHaveLength(1);
    expect(listed.body.sessions[0].current).toBe(true);
  });

  it('rejects a cookie-authenticated state change that carries no CSRF token', async () => {
    const session = await cookieSession('nocsrf@example.com');

    const rejected = await request(server)
      .post('/v1/auth/logout')
      .set('Cookie', session.authCookies)
      .expect(403);

    expect(rejected.body.code).toBe('FORBIDDEN');

    // The session survives: a rejected request must not have logged anyone out.
    await request(server).get('/v1/auth/sessions').set('Cookie', session.authCookies).expect(200);
  });

  it('rejects a cookie-authenticated state change whose CSRF token is wrong', async () => {
    const session = await cookieSession('badcsrf@example.com');

    await request(server)
      .post('/v1/auth/logout')
      .set('Cookie', session.authCookies)
      .set(CSRF_HEADER, 'fcs_forged-token')
      .expect(403);
  });

  it('accepts the state change once the CSRF token matches, and clears the cookies', async () => {
    const session = await cookieSession('logout@example.com');

    const loggedOut = await request(server)
      .post('/v1/auth/logout')
      .set('Cookie', session.authCookies)
      .set(CSRF_HEADER, session.csrfToken)
      .expect(204);

    // Every cookie is cleared on the same path it was set with, or the browser
    // would keep the original and sit on a revoked credential.
    expect(rawCookie(loggedOut, ACCESS_COOKIE)).toContain('Path=/v1');
    expect(rawCookie(loggedOut, REFRESH_COOKIE)).toContain('Path=/v1/auth/refresh');
    expect(cookieValue(loggedOut, ACCESS_COOKIE)).toBe('');

    await request(server).get('/v1/auth/sessions').set('Cookie', session.authCookies).expect(401);
  });

  it('rejects a bearer token presented as a cookie: no CSRF hash means no cookie use', async () => {
    // A session minted in body transport has no CSRF token bound to it, so it
    // must not become cookie-drivable just because someone moves the token.
    const { response } = await onboardAndEnrol('bearer-as-cookie@example.com');
    const { accessToken } = bodySession(response);

    // Reading is fine — no ambient-credential risk on a safe method.
    await request(server)
      .get('/v1/auth/sessions')
      .set('Cookie', cookieHeader({ [ACCESS_COOKIE]: accessToken }))
      .expect(200);

    // Writing is not, and no forged CSRF token can unlock it.
    await request(server)
      .post('/v1/auth/logout')
      .set('Cookie', cookieHeader({ [ACCESS_COOKIE]: accessToken }))
      .set(CSRF_HEADER, 'fcs_anything')
      .expect(403);
  });

  describe('refresh', () => {
    it('rotates from the cookie when the CSRF token matches', async () => {
      const session = await cookieSession('refresh-ok@example.com');

      const refreshed = await request(server)
        .post('/v1/auth/refresh')
        .set(TOKEN_TRANSPORT_HEADER, 'cookie')
        .set(
          'Cookie',
          cookieHeader({
            [REFRESH_COOKIE]: session.refreshCookie,
            [CSRF_COOKIE]: session.csrfToken,
          }),
        )
        .set(CSRF_HEADER, session.csrfToken)
        .send({})
        .expect(200);

      expect(refreshed.body.accessToken).toBeUndefined();
      expect(refreshed.body.refreshToken).toBeUndefined();

      // Rotation issues a new pair and a new CSRF token.
      expect(cookieValue(refreshed, ACCESS_COOKIE)).not.toBe(session.accessCookie);
      expect(cookieValue(refreshed, REFRESH_COOKIE)).not.toBe(session.refreshCookie);
      expect(cookieValue(refreshed, CSRF_COOKIE)).not.toBe(session.csrfToken);
    });

    it('refuses a cookie-driven refresh with no CSRF token, leaving the session intact', async () => {
      // Refresh sits outside SessionAuthGuard (it runs on an expired access
      // token), so this is enforced inside the rotation transaction instead.
      const session = await cookieSession('refresh-nocsrf@example.com');

      await request(server)
        .post('/v1/auth/refresh')
        .set(TOKEN_TRANSPORT_HEADER, 'cookie')
        .set('Cookie', cookieHeader({ [REFRESH_COOKIE]: session.refreshCookie }))
        .send({})
        .expect(403);

      // Nothing rotated, so the original cookies still work.
      await request(server).get('/v1/auth/sessions').set('Cookie', session.authCookies).expect(200);
    });

    it('still accepts a body-supplied refresh token without any CSRF token', async () => {
      const { response } = await onboardAndEnrol('refresh-body@example.com');
      const { refreshToken } = bodySession(response);

      const refreshed = await request(server)
        .post('/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(refreshed.body.accessToken).toMatch(/^fat_/);
      expect(setCookies(refreshed)).toHaveLength(0);
    });

    it('rejects a refresh that supplies no token at all', async () => {
      await request(server).post('/v1/auth/refresh').send({}).expect(401);
    });
  });
});

describe('security headers (integration, ADR-0027)', () => {
  it('sets transport and content protections on an API response', async () => {
    const response = await request(server).get('/health').expect(200);

    expect(response.headers['strict-transport-security']).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    // Express advertising itself is free reconnaissance.
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('locks the JSON surface down to loading nothing at all', async () => {
    const response = await request(server).get('/health').expect(200);
    const csp = response.headers['content-security-policy'];

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it('relaxes the policy only for the docs page that needs it', async () => {
    const docs = await request(server).get('/docs').expect(200);
    const csp = docs.headers['content-security-policy'];

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'unsafe-inline'");
    // The relaxation must not extend to being framed.
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe('native app association (integration, ADR-0027)', () => {
  it('serves the Apple association document unversioned, as JSON', async () => {
    const response = await request(server)
      .get('/.well-known/apple-app-site-association')
      .expect(200);

    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).toEqual({ webcredentials: { apps: [IOS_APP_ID] } });
  });

  it('serves the Android asset links with the login-credentials relation', async () => {
    const response = await request(server).get('/.well-known/assetlinks.json').expect(200);

    expect(response.body).toEqual([
      {
        relation: ['delegate_permission/common.get_login_creds'],
        target: {
          namespace: 'android_app',
          package_name: ANDROID_PACKAGE,
          sha256_cert_fingerprints: [ANDROID_FINGERPRINT],
        },
      },
    ]);
  });

  it('keeps the association paths outside the /v1 prefix', async () => {
    await request(server).get('/v1/.well-known/assetlinks.json').expect(404);
  });
});
