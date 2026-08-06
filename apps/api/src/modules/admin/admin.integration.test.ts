import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, type TestDatabase } from '../../../test/db';
import { TEST_SCRYPT_PARAMS } from '../../../test/admin';
import { TestClock } from '../../../test/clock';
import { KeyringEncryption, isEncrypted, parseKeyring } from '../../shared/crypto/encryption';
import { hashPassword } from '../../shared/crypto/password';
import {
  DEFAULT_TOTP_CONFIG,
  generateTotp,
  generateTotpSecret,
  totpStep,
} from '../../shared/crypto/totp';
import { UuidV7Generator } from '../../shared/ids/uuid-v7';
import { AuditAction } from '../audit/application/audit-actions';
import { AuditService } from '../audit/application/audit.service';
import { auditLog } from '../audit/infra/audit.schema';
import {
  ADMIN_LOGIN_CHALLENGE_TTL_MS,
  AdminIdentityService,
  type AdminIdentityConfig,
} from './application/admin-identity.service';
import {
  AdminSessionService,
  type AdminPrincipal,
  type AdminSessionConfig,
} from './application/admin-session.service';
import { AdminSweeper } from './application/admin-sweeper';
import { adminLoginChallenges, adminSessions, admins } from './infra/admin.schema';

const ids = new UuidV7Generator();
const { db, close } = createTestDb();

/** Deadlines are asserted by moving the clock, never by waiting them out. */
const clock = new TestClock();
const audit = new AuditService(db as TestDatabase, ids, clock);

const SESSION_CONFIG: AdminSessionConfig = {
  idleTtlMs: 30 * 60 * 1000,
  absoluteTtlMs: 8 * 60 * 60 * 1000,
};

/** Matches the `ADMIN_LOCKOUT_*` env defaults (ADR-0029). */
const DEFAULT_LOCKOUT_THRESHOLD = 5;
const DEFAULT_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

const encryption = new KeyringEncryption(
  parseKeyring(`test:${Buffer.alloc(32, 7).toString('base64')}`),
);

function identityService(overrides: Partial<AdminIdentityConfig> = {}): {
  identity: AdminIdentityService;
  sessions: AdminSessionService;
} {
  const sessions = new AdminSessionService(db as TestDatabase, ids, clock, audit, SESSION_CONFIG);
  const identity = new AdminIdentityService(
    db as TestDatabase,
    ids,
    clock,
    audit,
    sessions,
    encryption,
    {
      issuer: 'Fides',
      loginChallengeTtlMs: ADMIN_LOGIN_CHALLENGE_TTL_MS,
      totp: DEFAULT_TOTP_CONFIG,
      lockoutThreshold: DEFAULT_LOCKOUT_THRESHOLD,
      lockoutDurationMs: DEFAULT_LOCKOUT_DURATION_MS,
      ...overrides,
    },
  );
  return { identity, sessions };
}

/** Insert an admin with cheap KDF parameters; the format is identical. */
async function insertAdmin(input: {
  id: string;
  email: string;
  role: 'super_admin' | 'support_agent';
  password: string;
}): Promise<void> {
  await db.insert(admins).values({
    id: input.id,
    email: input.email,
    role: input.role,
    passwordHash: await hashPassword(input.password, TEST_SCRYPT_PARAMS),
  });
}

const SUPER_ID = '00000000-0000-7000-8000-00000000a001';
const AGENT_ID = '00000000-0000-7000-8000-00000000a002';
const PASSWORD = 'correct-horse-battery-staple';

beforeEach(async () => {
  await resetDb(db as TestDatabase);
  clock.reset();
});

afterAll(async () => {
  await close();
});

describe('admin bootstrap seeding', () => {
  it('creates the first super_admin and audits it as a system action', async () => {
    const { identity } = identityService({
      bootstrapEmail: 'Ops@Fides.Local',
      bootstrapPassword: 'a-sufficiently-long-password',
    });

    const result = await identity.seedFirstAdmin();
    expect(result.seeded).toBe(true);

    const [admin] = await db.select().from(admins);
    expect(admin).toMatchObject({
      email: 'ops@fides.local',
      role: 'super_admin',
      status: 'active',
    });
    // Seeded with a password only: the second factor is enrolled at first login.
    expect(admin!.totpSecret).toBeNull();
    expect(admin!.totpEnrolledAt).toBeNull();

    const [record] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, AuditAction.AdminSeeded));
    expect(record).toMatchObject({ actorType: 'system', actorId: null, resourceId: admin!.id });
  });

  it('is idempotent and never seeds once any admin exists', async () => {
    const { identity } = identityService({
      bootstrapEmail: 'ops@fides.local',
      bootstrapPassword: 'a-sufficiently-long-password',
    });
    await identity.seedFirstAdmin();

    // A second boot, and a boot with different configuration, both no-op: the
    // environment cannot add or reset an admin once the back office is live.
    expect(await identity.seedFirstAdmin()).toMatchObject({ seeded: false });
    const { identity: other } = identityService({
      bootstrapEmail: 'attacker@evil.example',
      bootstrapPassword: 'another-long-password',
    });
    expect(await other.seedFirstAdmin()).toMatchObject({ seeded: false });
    expect(await db.select().from(admins)).toHaveLength(1);
  });

  it('does nothing without configuration, and rejects a weak bootstrap password', async () => {
    const { identity: unconfigured } = identityService();
    expect(await unconfigured.seedFirstAdmin()).toMatchObject({ seeded: false, adminId: null });

    const { identity: weak } = identityService({
      bootstrapEmail: 'ops@fides.local',
      bootstrapPassword: 'short',
    });
    await expect(weak.seedFirstAdmin()).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await db.select().from(admins)).toHaveLength(0);
  });
});

describe('admin two-factor login', () => {
  beforeEach(async () => {
    await insertAdmin({
      id: SUPER_ID,
      email: 'ops@fides.local',
      role: 'super_admin',
      password: PASSWORD,
    });
  });

  it('yields only a challenge for the password, and a session for the code', async () => {
    const { identity, sessions } = identityService();

    const challenge = await identity.login('ops@fides.local', PASSWORD);
    expect(challenge.mfaEnrolled).toBe(false);
    expect(challenge.challengeToken).toMatch(/^alc_/);
    // No session exists on one factor.
    expect(await db.select().from(adminSessions)).toHaveLength(0);

    const enrolment = await identity.beginMfaEnrolment(challenge.challengeToken);
    expect(enrolment.otpauthUri).toContain('otpauth://totp/Fides:ops%40fides.local');

    const code = generateTotp(enrolment.secret, clock.now().getTime());
    const session = await identity.verifyMfa(challenge.challengeToken, code);
    expect(session.token).toMatch(/^ast_/);

    const principal = await sessions.validateToken(session.token);
    expect(principal).toMatchObject({ adminId: SUPER_ID, role: 'super_admin' });

    // Enrolment activated, and both the enrolment and the sign-in are audited.
    const [admin] = await db.select().from(admins).where(eq(admins.id, SUPER_ID));
    expect(admin!.totpEnrolledAt).not.toBeNull();
    const actions = (await db.select().from(auditLog)).map((row) => row.action);
    expect(actions).toContain(AuditAction.AdminMfaEnrolled);
    expect(actions).toContain(AuditAction.AdminSessionIssued);
  });

  it('fails uniformly for a wrong password, an unknown email, and a disabled admin', async () => {
    const { identity } = identityService();
    await expect(identity.login('ops@fides.local', 'wrong-password')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(identity.login('nobody@fides.local', PASSWORD)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    await db.update(admins).set({ status: 'disabled' }).where(eq(admins.id, SUPER_ID));
    await expect(identity.login('ops@fides.local', PASSWORD)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects a wrong code but leaves the challenge usable for a genuine retry', async () => {
    const { identity } = identityService();
    const challenge = await identity.login('ops@fides.local', PASSWORD);
    const { secret } = await identity.beginMfaEnrolment(challenge.challengeToken);

    await expect(identity.verifyMfa(challenge.challengeToken, '000000')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    // The failed attempt rolled back, including the challenge's consumption, so
    // a typo does not cost the operator the password step.
    const session = await identity.verifyMfa(
      challenge.challengeToken,
      generateTotp(secret, clock.now().getTime()),
    );
    expect(session.token).toMatch(/^ast_/);
  });

  it('refuses to replay a code, even inside its own validity window', async () => {
    const { identity } = identityService();
    const first = await identity.login('ops@fides.local', PASSWORD);
    const { secret } = await identity.beginMfaEnrolment(first.challengeToken);
    const code = generateTotp(secret, clock.now().getTime());
    await identity.verifyMfa(first.challengeToken, code);

    // A fresh challenge, the very same code: the replay guard rejects it.
    const second = await identity.login('ops@fides.local', PASSWORD);
    await expect(identity.verifyMfa(second.challengeToken, code)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    const [admin] = await db.select().from(admins).where(eq(admins.id, SUPER_ID));
    expect(admin!.lastTotpStep).toBe(totpStep(clock.now().getTime()));

    // The next time step is accepted again.
    clock.advance(30_000);
    const third = await identity.login('ops@fides.local', PASSWORD);
    const next = generateTotp(secret, clock.now().getTime());
    await expect(identity.verifyMfa(third.challengeToken, next)).resolves.toMatchObject({
      adminId: SUPER_ID,
    });
  });

  it('consumes a challenge once and expires it after its TTL', async () => {
    const { identity } = identityService();
    const challenge = await identity.login('ops@fides.local', PASSWORD);
    const { secret } = await identity.beginMfaEnrolment(challenge.challengeToken);
    await identity.verifyMfa(challenge.challengeToken, generateTotp(secret, clock.now().getTime()));

    await expect(
      identity.verifyMfa(challenge.challengeToken, generateTotp(secret, clock.now().getTime())),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const stale = await identity.login('ops@fides.local', PASSWORD);
    clock.advance(ADMIN_LOGIN_CHALLENGE_TTL_MS + 1);
    await expect(
      identity.verifyMfa(stale.challengeToken, generateTotp(secret, clock.now().getTime())),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('hands out an enrolment secret once per login, and never once enrolled', async () => {
    const { identity } = identityService();
    const challenge = await identity.login('ops@fides.local', PASSWORD);
    const first = await identity.beginMfaEnrolment(challenge.challengeToken);

    await expect(identity.beginMfaEnrolment(challenge.challengeToken)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    await identity.verifyMfa(
      challenge.challengeToken,
      generateTotp(first.secret, clock.now().getTime()),
    );
    clock.advance(60_000);
    const later = await identity.login('ops@fides.local', PASSWORD);
    expect(later.mfaEnrolled).toBe(true);
    await expect(identity.beginMfaEnrolment(later.challengeToken)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('will not sign in an admin whose enrolment never completed', async () => {
    const { identity } = identityService();
    // A secret exists but was never activated by a successful verification.
    await db
      .update(admins)
      .set({ totpSecret: null, totpEnrolledAt: null })
      .where(eq(admins.id, SUPER_ID));
    const challenge = await identity.login('ops@fides.local', PASSWORD);
    await expect(identity.verifyMfa(challenge.challengeToken, '123456')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});

describe('admin sessions', () => {
  const secret = generateTotpSecret();

  async function issue(): Promise<{ token: string; sessions: AdminSessionService }> {
    const { sessions } = identityService();
    const issued = await db.transaction((tx) => sessions.issueSession(tx, SUPER_ID));
    return { token: issued.token, sessions };
  }

  beforeEach(async () => {
    await insertAdmin({
      id: SUPER_ID,
      email: 'ops@fides.local',
      role: 'super_admin',
      password: PASSWORD,
    });
    await db
      .update(admins)
      .set({ totpSecret: secret, totpEnrolledAt: clock.now() })
      .where(eq(admins.id, SUPER_ID));
  });

  it('slides the idle deadline forward on use', async () => {
    const { token, sessions } = await issue();

    // Well inside the idle window, but past the write-throttle interval.
    const before = (await db.select().from(adminSessions))[0]!.idleExpiresAt.getTime();
    clock.advance(20 * 60 * 1000);
    await sessions.validateToken(token);

    const [slid] = await db.select().from(adminSessions);
    // Anchored to the instant the service recorded, not to a second reading of
    // the clock, which advances in real time between the two.
    expect(slid!.idleExpiresAt.getTime()).toBe(
      slid!.lastUsedAt.getTime() + SESSION_CONFIG.idleTtlMs,
    );
    expect(slid!.idleExpiresAt.getTime()).toBeGreaterThan(before);
  });

  it('clamps the slid idle deadline to the absolute cap', async () => {
    // A deliberately tight config: the idle window would otherwise reach past
    // the cap, which is exactly the case the clamp exists for.
    const tight = new AdminSessionService(db as TestDatabase, ids, clock, audit, {
      idleTtlMs: 30 * 60 * 1000,
      absoluteTtlMs: 45 * 60 * 1000,
    });
    const issued = await db.transaction((tx) => tight.issueSession(tx, SUPER_ID));

    clock.advance(20 * 60 * 1000);
    await tight.validateToken(issued.token);

    const [row] = await db.select().from(adminSessions);
    // 20 + 30 = 50 minutes would exceed the 45-minute cap, so it is clamped.
    expect(row!.idleExpiresAt.getTime()).toBe(row!.absoluteExpiresAt.getTime());
  });

  it('expires through inactivity', async () => {
    const { token, sessions } = await issue();
    clock.advance(SESSION_CONFIG.idleTtlMs + 1);
    await expect(sessions.validateToken(token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('expires at the absolute cap however active the admin has been', async () => {
    const { token, sessions } = await issue();
    // Continuous activity in 25-minute steps, inside the 30-minute idle window.
    const step = 25 * 60 * 1000;
    for (let elapsed = step; elapsed < SESSION_CONFIG.absoluteTtlMs; elapsed += step) {
      clock.advance(step);
      await sessions.validateToken(token);
    }
    clock.advance(step);
    await expect(sessions.validateToken(token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('revokes immediately and audits only a real revocation', async () => {
    const { token, sessions } = await issue();
    const principal = await sessions.validateToken(token);

    await sessions.revokeSession(principal.sessionId, { adminId: SUPER_ID });
    await expect(sessions.validateToken(token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    // Revoking again writes no second record.
    await sessions.revokeSession(principal.sessionId, { adminId: SUPER_ID });
    const revocations = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, AuditAction.AdminSessionRevoked));
    expect(revocations).toHaveLength(1);
    expect(revocations[0]!.actorType).toBe('admin');
  });

  it('cuts off a disabled admin on their next request', async () => {
    const { token, sessions } = await issue();
    await db.update(admins).set({ status: 'disabled' }).where(eq(admins.id, SUPER_ID));
    await expect(sessions.validateToken(token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects an unknown token', async () => {
    const { sessions } = identityService();
    await expect(sessions.validateToken('ast_not-a-real-token')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});

describe('admin staffing', () => {
  const actor: AdminPrincipal = {
    adminId: SUPER_ID,
    sessionId: '00000000-0000-7000-8000-00000000b001',
    role: 'super_admin',
    email: 'ops@fides.local',
  };

  beforeEach(async () => {
    await insertAdmin({
      id: SUPER_ID,
      email: 'ops@fides.local',
      role: 'super_admin',
      password: PASSWORD,
    });
  });

  it('creates an operator who must enrol a second factor, and audits it', async () => {
    const { identity } = identityService();
    const created = await identity.createAdmin(actor, {
      email: 'Agent@Fides.Local',
      role: 'support_agent',
      password: 'another-long-enough-password',
    });

    expect(created).toMatchObject({
      email: 'agent@fides.local',
      role: 'support_agent',
      status: 'active',
      mfaEnrolled: false,
    });
    const [record] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, AuditAction.AdminCreated));
    expect(record).toMatchObject({ actorType: 'admin', actorId: SUPER_ID });
  });

  it('rejects a duplicate email and a weak password', async () => {
    const { identity } = identityService();
    await expect(
      identity.createAdmin(actor, {
        email: 'ops@fides.local',
        role: 'auditor',
        password: 'another-long-enough-password',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      identity.createAdmin(actor, { email: 'x@fides.local', role: 'auditor', password: 'short' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('disables an operator, which ends their live sessions, and refuses self-disable', async () => {
    const { identity, sessions } = identityService();
    await insertAdmin({
      id: AGENT_ID,
      email: 'agent@fides.local',
      role: 'support_agent',
      password: PASSWORD,
    });
    const issued = await db.transaction((tx) => sessions.issueSession(tx, AGENT_ID));

    await identity.setAdminStatus(actor, AGENT_ID, 'disabled');
    await expect(sessions.validateToken(issued.token)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    await expect(identity.setAdminStatus(actor, SUPER_ID, 'disabled')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    // Re-enabling is audited too, and the status change is idempotent.
    await identity.setAdminStatus(actor, AGENT_ID, 'active');
    const changes = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, AuditAction.AdminStatusChanged));
    expect(changes).toHaveLength(2);
    await identity.setAdminStatus(actor, AGENT_ID, 'active');
    expect(
      await db.select().from(auditLog).where(eq(auditLog.action, AuditAction.AdminStatusChanged)),
    ).toHaveLength(2);
  });
});

describe('admin retention sweeper', () => {
  it('purges dead sessions and spent login challenges', async () => {
    await insertAdmin({
      id: SUPER_ID,
      email: 'ops@fides.local',
      role: 'super_admin',
      password: PASSWORD,
    });
    const { identity, sessions } = identityService();
    const sweeper = new AdminSweeper(db as TestDatabase, clock);

    const challenge = await identity.login('ops@fides.local', PASSWORD);
    const { secret } = await identity.beginMfaEnrolment(challenge.challengeToken);
    const session = await identity.verifyMfa(
      challenge.challengeToken,
      generateTotp(secret, clock.now().getTime()),
    );

    // A live session and a consumed challenge: only the challenge is dead.
    expect(await sweeper.sweep()).toEqual({ loginChallenges: 1, sessions: 0 });
    expect(await db.select().from(adminLoginChallenges)).toHaveLength(0);

    await sessions.revokeSession(session.sessionId);
    expect(await sweeper.sweep()).toEqual({ loginChallenges: 0, sessions: 1 });
    expect(await db.select().from(adminSessions)).toHaveLength(0);

    // The audit trail is never swept: the forensic record outlives the row.
    expect(await audit.verify()).toMatchObject({ ok: true });
  });
});

describe('admin TOTP secrets at rest (ADR-0028)', () => {
  beforeEach(async () => {
    await insertAdmin({
      id: SUPER_ID,
      email: 'ops@fides.local',
      role: 'super_admin',
      password: PASSWORD,
    });
  });

  it('stores the secret sealed, never as the base32 an authenticator would accept', async () => {
    const { identity } = identityService();
    const challenge = await identity.login('ops@fides.local', PASSWORD);
    const { secret } = await identity.beginMfaEnrolment(challenge.challengeToken);

    const [admin] = await db.select().from(admins).where(eq(admins.id, SUPER_ID));
    // The whole point: a database read yields no usable second factor.
    expect(admin!.totpSecret).not.toBe(secret);
    expect(admin!.totpSecret).not.toContain(secret);
    expect(isEncrypted(admin!.totpSecret!)).toBe(true);

    // And it still verifies, so the sealing is transparent to the ceremony.
    const session = await identity.verifyMfa(
      challenge.challengeToken,
      generateTotp(secret, clock.now().getTime()),
    );
    expect(session.token).toMatch(/^ast_/);
  });

  it('refuses a secret grafted onto another admin row', async () => {
    // Encryption alone would not stop this — the copied ciphertext would
    // decrypt fine. Binding the admin id as additional authenticated data is
    // what makes an attacker with database write access unable to promote
    // themselves by cloning a colleague's second factor.
    const { identity } = identityService();
    const challenge = await identity.login('ops@fides.local', PASSWORD);
    const { secret } = await identity.beginMfaEnrolment(challenge.challengeToken);
    const [source] = await db.select().from(admins).where(eq(admins.id, SUPER_ID));

    await insertAdmin({
      id: AGENT_ID,
      email: 'agent@fides.local',
      role: 'support_agent',
      password: PASSWORD,
    });
    await db
      .update(admins)
      .set({ totpSecret: source!.totpSecret, totpEnrolledAt: clock.now() })
      .where(eq(admins.id, AGENT_ID));

    const agentChallenge = await identity.login('agent@fides.local', PASSWORD);
    await expect(
      identity.verifyMfa(
        agentChallenge.challengeToken,
        generateTotp(secret, clock.now().getTime()),
      ),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('still verifies a pre-ADR-0028 plaintext secret, and re-seals it in place', async () => {
    // Rows written before this slice hold bare base32. They must keep working,
    // and must not stay plaintext once they have proven themselves.
    const { identity } = identityService();
    const legacy = generateTotpSecret();
    await db
      .update(admins)
      .set({ totpSecret: legacy, totpEnrolledAt: clock.now() })
      .where(eq(admins.id, SUPER_ID));

    const challenge = await identity.login('ops@fides.local', PASSWORD);
    const session = await identity.verifyMfa(
      challenge.challengeToken,
      generateTotp(legacy, clock.now().getTime()),
    );
    expect(session.token).toMatch(/^ast_/);

    const [admin] = await db.select().from(admins).where(eq(admins.id, SUPER_ID));
    expect(isEncrypted(admin!.totpSecret!)).toBe(true);
    expect(admin!.totpSecret).not.toBe(legacy);
  });

  it('leaves a plaintext secret alone when the code was wrong', async () => {
    // Re-sealing on read would re-encrypt on failed attempts too; it belongs on
    // the one path that has just proven the plaintext is the real secret.
    const { identity } = identityService();
    const legacy = generateTotpSecret();
    await db
      .update(admins)
      .set({ totpSecret: legacy, totpEnrolledAt: clock.now() })
      .where(eq(admins.id, SUPER_ID));

    const challenge = await identity.login('ops@fides.local', PASSWORD);
    await expect(identity.verifyMfa(challenge.challengeToken, '000000')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    const [admin] = await db.select().from(admins).where(eq(admins.id, SUPER_ID));
    expect(admin!.totpSecret).toBe(legacy);
  });
});

describe('admin login lockout (ADR-0029)', () => {
  beforeEach(async () => {
    await insertAdmin({
      id: SUPER_ID,
      email: 'ops@fides.local',
      role: 'super_admin',
      password: PASSWORD,
    });
  });

  async function failPassword(identity: AdminIdentityService, times: number): Promise<void> {
    for (let attempt = 0; attempt < times; attempt++) {
      await expect(identity.login('ops@fides.local', 'wrong-password')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    }
  }

  it('locks the account after the threshold, and then refuses the correct password', async () => {
    const { identity } = identityService({ lockoutThreshold: 3 });
    await failPassword(identity, 3);

    // The credential is right; the account is not available. This is the whole
    // control: throttling slows guessing, a lockout stops it.
    await expect(identity.login('ops@fides.local', PASSWORD)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    const [admin] = await db.select().from(admins).where(eq(admins.id, SUPER_ID));
    expect(admin!.lockedUntil).not.toBeNull();
  });

  it('counts a rejected TOTP code, which no rollback may discard', async () => {
    // The regression this exists for: `verifyMfa` rolls its transaction back so
    // a typo does not spend the challenge. An increment written inside that
    // transaction would roll back with it, and the second factor would be
    // guessable forever.
    const { identity } = identityService({ lockoutThreshold: 3 });
    const challenge = await identity.login('ops@fides.local', PASSWORD);
    await identity.beginMfaEnrolment(challenge.challengeToken);

    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(identity.verifyMfa(challenge.challengeToken, '000000')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    }

    const [admin] = await db.select().from(admins).where(eq(admins.id, SUPER_ID));
    expect(admin!.lockedUntil).not.toBeNull();
  });

  it('releases the account once the lock expires', async () => {
    const { identity } = identityService({ lockoutThreshold: 3, lockoutDurationMs: 60_000 });
    await failPassword(identity, 3);
    await expect(identity.login('ops@fides.local', PASSWORD)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    clock.advance(60_001);
    const challenge = await identity.login('ops@fides.local', PASSWORD);
    expect(challenge.challengeToken).toMatch(/^alc_/);
  });

  it('clears the counter only when both factors have succeeded', async () => {
    const { identity } = identityService({ lockoutThreshold: 5 });
    await failPassword(identity, 3);

    // A correct password alone must not reset it: an attacker who has the
    // password could otherwise reset the counter at will and grind the code.
    const challenge = await identity.login('ops@fides.local', PASSWORD);
    const [midway] = await db.select().from(admins).where(eq(admins.id, SUPER_ID));
    expect(midway!.failedLoginAttempts).toBe(3);

    const { secret } = await identity.beginMfaEnrolment(challenge.challengeToken);
    await identity.verifyMfa(challenge.challengeToken, generateTotp(secret, clock.now().getTime()));

    const [after] = await db.select().from(admins).where(eq(admins.id, SUPER_ID));
    expect(after!.failedLoginAttempts).toBe(0);
    expect(after!.lockedUntil).toBeNull();
  });

  it('audits every denial and the lock itself, on the tamper-evident chain', async () => {
    const { identity } = identityService({ lockoutThreshold: 2 });
    await failPassword(identity, 2);

    const rows = await db.select().from(auditLog);
    const denials = rows.filter((row) => row.action === AuditAction.AdminAuthDenied);
    expect(denials).toHaveLength(2);
    expect(denials[0]!.actorType).toBe('admin');
    expect(denials[0]!.metadata).toMatchObject({ factor: 'password' });
    expect(rows.filter((row) => row.action === AuditAction.AdminLocked)).toHaveLength(1);

    // Written in their own transactions, outside any action — the chain must
    // still be intact.
    expect(await audit.verify()).toMatchObject({ ok: true });
  });

  it('records nothing for an unknown address', async () => {
    // No admin to reference, and the address itself is PII the trail must not
    // hold (ADR-0024). Unknown-address volume is the throttle's problem.
    const { identity } = identityService({ lockoutThreshold: 2 });
    await expect(identity.login('nobody@fides.local', PASSWORD)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it('does not count a spent challenge against the operator', async () => {
    // Otherwise anyone holding a dead token could lock an operator out.
    const { identity } = identityService({ lockoutThreshold: 2 });
    const challenge = await identity.login('ops@fides.local', PASSWORD);
    const { secret } = await identity.beginMfaEnrolment(challenge.challengeToken);
    await identity.verifyMfa(challenge.challengeToken, generateTotp(secret, clock.now().getTime()));

    await expect(identity.verifyMfa(challenge.challengeToken, '000000')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    const [admin] = await db.select().from(admins).where(eq(admins.id, SUPER_ID));
    expect(admin!.failedLoginAttempts).toBe(0);
  });
});
