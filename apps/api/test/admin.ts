import request from 'supertest';
import { hashPassword } from '../src/shared/crypto/password';
import { generateTotp } from '../src/shared/crypto/totp';
import { admins, type AdminRole } from '../src/modules/admin/infra/admin.schema';
import type { TestDatabase } from './db';

/** Cheap scrypt parameters: these suites exercise the flow, not the KDF's cost. */
export const TEST_SCRYPT_PARAMS = {
  cost: 1024,
  blockSize: 8,
  parallelization: 1,
  keyLength: 64,
};

export interface SeededAdmin {
  readonly id: string;
  readonly email: string;
  readonly role: AdminRole;
  readonly password: string;
}

/**
 * Insert an admin directly, bypassing the HTTP staffing route. Used to set up
 * the state a test is not itself testing — the four-eyes journey creates its
 * maker through the real endpoint.
 */
export async function seedAdmin(
  db: TestDatabase,
  input: {
    readonly id: string;
    readonly email: string;
    readonly role: AdminRole;
    readonly password?: string;
  },
): Promise<SeededAdmin> {
  const password = input.password ?? 'correct-horse-battery-staple';
  await db.insert(admins).values({
    id: input.id,
    email: input.email.toLowerCase(),
    role: input.role,
    passwordHash: await hashPassword(password, TEST_SCRYPT_PARAMS),
  });
  return { id: input.id, email: input.email.toLowerCase(), role: input.role, password };
}

export interface AdminSession {
  readonly adminId: string;
  readonly email: string;
  readonly token: string;
  /** Kept so later codes for the same admin can advance past the replay guard. */
  readonly secret: string;
}

/**
 * Drive the real two-step login over HTTP: password, then TOTP — enrolling a
 * second factor first when the admin has none. Mirrors exactly what an operator
 * does on their first sign-in.
 */
export async function signInAdmin(
  server: Parameters<typeof request>[0],
  credentials: { readonly email: string; readonly password: string },
  options: { readonly secret?: string; readonly atMs?: number } = {},
): Promise<AdminSession> {
  const login = await request(server)
    .post('/v1/admin/auth/login')
    .send({ email: credentials.email, password: credentials.password })
    .expect(200);

  const challengeToken = login.body.challengeToken as string;
  let secret = options.secret;
  if (!(login.body.mfaEnrolled as boolean)) {
    const enrolled = await request(server)
      .post('/v1/admin/auth/mfa/enrol')
      .send({ challengeToken })
      .expect(200);
    secret = enrolled.body.secret as string;
  }
  if (!secret) throw new Error('An enrolled admin needs its TOTP secret to sign in');

  const verified = await request(server)
    .post('/v1/admin/auth/mfa/verify')
    .send({ challengeToken, code: generateTotp(secret, options.atMs ?? Date.now()) })
    .expect(201);

  return {
    adminId: verified.body.adminId as string,
    email: credentials.email.toLowerCase(),
    token: verified.body.token as string,
    secret,
  };
}
