import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  type EventClock,
  type IdGenerator,
} from '@fides/domain';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Database, DbExecutor } from '../../../database/db.types';
import { sha256Hex } from '../../../shared/crypto/secrets';
import { credentials, webauthnChallenges, type WebauthnChallengeRow } from '../infra/auth.schema';
import { users, type UserRow } from '../infra/identity.schema';
import { assertEnrolmentTokenValid, consumeEnrolmentToken } from './enrolment-token';
import type { DeviceDescriptor, IssuedSession, SessionService } from './session.service';

/** How long an issued challenge stays verifiable. */
export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** COSE algorithms accepted from authenticators: ES256, RS256. */
const SUPPORTED_ALGORITHM_IDS = [-7, -257];

/** Relying-party identity; env-driven (WEBAUTHN_RP_ID / WEBAUTHN_ORIGINS). */
export interface WebAuthnConfig {
  readonly rpId: string;
  readonly rpName: string;
  readonly origins: readonly string[];
}

export interface StartRegistrationParams {
  readonly userId: string;
  /** Required for the first passkey; issued by email verification. */
  readonly enrolmentToken?: string;
  /** Required for additional passkeys; the guard-validated principal's userId. */
  readonly authenticatedUserId?: string;
}

export interface FinishRegistrationParams extends StartRegistrationParams {
  readonly response: RegistrationResponseJSON;
  readonly device: DeviceDescriptor;
}

export interface FinishRegistrationResult {
  readonly credentialId: string;
  /** Auto-issued on first-passkey enrolment (ADR-0020); null when adding passkeys. */
  readonly session: IssuedSession | null;
}

export interface FinishAuthenticationParams {
  readonly response: AuthenticationResponseJSON;
  readonly device: DeviceDescriptor;
}

/**
 * WebAuthn relying party (ADR-0007, ADR-0020).
 *
 * Ceremonies demand user verification, so every assertion carries two factors
 * (possession + inherence/knowledge). Challenges are single-use rows stored by
 * hash; unknown emails receive indistinguishable decoy options so login cannot
 * be used to enumerate accounts.
 */
export class WebAuthnService {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
    private readonly clock: EventClock,
    private readonly sessions: SessionService,
    private readonly config: WebAuthnConfig,
  ) {}

  /** Issue creation options. First passkey: enrolment-token gated; later ones: session gated. */
  async startRegistration(
    params: StartRegistrationParams,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const now = this.clock.now();
    const user = await this.requireUser(params.userId);
    const existing = await this.db
      .select()
      .from(credentials)
      .where(eq(credentials.userId, user.id));

    await this.assertRegistrationAllowed(this.db, params, existing.length === 0, now);

    const options = await generateRegistrationOptions({
      rpName: this.config.rpName,
      rpID: this.config.rpId,
      userName: user.email,
      userID: isoUint8Array.fromUTF8String(user.id),
      attestationType: 'none',
      excludeCredentials: existing.map((credential) => ({
        id: credential.credentialId,
        transports: (credential.transports ?? undefined) as
          AuthenticatorTransportFuture[] | undefined,
      })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
    });

    await this.storeChallenge(options.challenge, 'registration', user.id, now);
    return options;
  }

  /** Verify the attestation, store the credential, and auto-issue the first session. */
  async finishRegistration(params: FinishRegistrationParams): Promise<FinishRegistrationResult> {
    const now = this.clock.now();
    const clientChallenge = extractClientChallenge(params.response.response.clientDataJSON);
    await this.consumeChallenge(clientChallenge, 'registration', now, params.userId);

    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response: params.response,
        expectedChallenge: clientChallenge,
        expectedOrigin: [...this.config.origins],
        expectedRPID: this.config.rpId,
        requireUserVerification: true,
      });
    } catch (error) {
      throw new AuthenticationError('Passkey registration could not be verified', {
        reason: errorMessage(error),
      });
    }
    if (!verification.verified || !verification.registrationInfo) {
      throw new AuthenticationError('Passkey registration could not be verified');
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    return this.db.transaction(async (tx) => {
      const user = await this.requireUser(params.userId, tx);
      const existing = await tx
        .select({ id: credentials.id })
        .from(credentials)
        .where(eq(credentials.userId, user.id))
        .limit(1);
      const isFirstPasskey = existing.length === 0;

      if (isFirstPasskey) {
        if (!params.enrolmentToken) {
          throw new AuthenticationError('Enrolment token required for the first passkey');
        }
        await consumeEnrolmentToken(tx, user.id, params.enrolmentToken, now);
      } else if (params.authenticatedUserId !== user.id) {
        throw new AuthenticationError('Authenticated session required to add a passkey');
      }

      const inserted = await tx
        .insert(credentials)
        .values({
          id: this.ids.next(),
          userId: user.id,
          credentialId: credential.id,
          publicKey: isoBase64URL.fromBuffer(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports ?? params.response.response.transports ?? null,
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
          deviceName: params.device.name,
          createdAt: now,
        })
        .onConflictDoNothing({ target: credentials.credentialId })
        .returning({ id: credentials.id });
      if (inserted.length === 0) {
        throw new ConflictError('This passkey is already registered');
      }

      const session = isFirstPasskey
        ? await this.sessions.issueSession(tx, user.id, params.device)
        : null;
      return { credentialId: credential.id, session };
    });
  }

  /**
   * Issue request options for an email-first login. Unknown emails and users
   * without passkeys receive decoy options bound to a userless challenge.
   */
  async startAuthentication(email: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const now = this.clock.now();
    const normalized = email.trim().toLowerCase();
    const [user] = await this.db.select().from(users).where(eq(users.email, normalized)).limit(1);
    const userCredentials = user
      ? await this.db.select().from(credentials).where(eq(credentials.userId, user.id))
      : [];

    if (!user || userCredentials.length === 0) {
      return this.issueDecoyAuthenticationOptions(now);
    }

    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      allowCredentials: userCredentials.map((credential) => ({
        id: credential.credentialId,
        transports: (credential.transports ?? undefined) as
          AuthenticatorTransportFuture[] | undefined,
      })),
      userVerification: 'required',
    });

    await this.storeChallenge(options.challenge, 'authentication', user.id, now);
    return options;
  }

  /** Verify the assertion and issue a session. Suspended users are rejected. */
  async finishAuthentication(params: FinishAuthenticationParams): Promise<IssuedSession> {
    const now = this.clock.now();
    const clientChallenge = extractClientChallenge(params.response.response.clientDataJSON);
    const challenge = await this.consumeChallenge(clientChallenge, 'authentication', now);
    if (challenge.userId === null) {
      // Decoy challenge: fail exactly like a bad assertion would.
      throw new AuthenticationError('Authentication failed');
    }

    const [credential] = await this.db
      .select()
      .from(credentials)
      .where(
        and(
          eq(credentials.credentialId, params.response.id),
          eq(credentials.userId, challenge.userId),
        ),
      )
      .limit(1);
    if (!credential) throw new AuthenticationError('Authentication failed');

    let verified: boolean;
    let newCounter: number;
    try {
      const verification = await verifyAuthenticationResponse({
        response: params.response,
        expectedChallenge: clientChallenge,
        expectedOrigin: [...this.config.origins],
        expectedRPID: this.config.rpId,
        credential: {
          id: credential.credentialId,
          publicKey: isoBase64URL.toBuffer(credential.publicKey),
          counter: credential.counter,
          transports: (credential.transports ?? undefined) as
            AuthenticatorTransportFuture[] | undefined,
        },
        requireUserVerification: true,
      });
      verified = verification.verified;
      newCounter = verification.authenticationInfo.newCounter;
    } catch (error) {
      throw new AuthenticationError('Authentication failed', { reason: errorMessage(error) });
    }
    if (!verified) throw new AuthenticationError('Authentication failed');

    const user = await this.requireUser(challenge.userId);
    if (user.status === 'suspended') throw new AuthorizationError('Account suspended');

    return this.db.transaction(async (tx) => {
      await tx
        .update(credentials)
        .set({ counter: newCounter, lastUsedAt: now })
        .where(eq(credentials.id, credential.id));
      return this.sessions.issueSession(tx, user.id, params.device);
    });
  }

  private async assertRegistrationAllowed(
    executor: DbExecutor,
    params: StartRegistrationParams,
    isFirstPasskey: boolean,
    now: Date,
  ): Promise<void> {
    if (isFirstPasskey) {
      if (!params.enrolmentToken) {
        throw new AuthenticationError('Enrolment token required for the first passkey');
      }
      await assertEnrolmentTokenValid(executor, params.userId, params.enrolmentToken, now);
    } else if (params.authenticatedUserId !== params.userId) {
      throw new AuthenticationError('Authenticated session required to add a passkey');
    }
  }

  private async requireUser(userId: string, executor: DbExecutor = this.db): Promise<UserRow> {
    const [user] = await executor.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundError('User not found', { userId });
    if (user.status === 'suspended') throw new AuthorizationError('Account suspended');
    return user;
  }

  private async storeChallenge(
    challenge: string,
    type: WebauthnChallengeRow['type'],
    userId: string | null,
    now: Date,
  ): Promise<void> {
    await this.db.insert(webauthnChallenges).values({
      id: this.ids.next(),
      challengeHash: sha256Hex(challenge),
      type,
      userId,
      expiresAt: new Date(now.getTime() + WEBAUTHN_CHALLENGE_TTL_MS),
      createdAt: now,
    });
  }

  /**
   * Atomically claim a challenge issued by us: it must exist (we only store
   * hashes of challenges we generated), match the ceremony type, be unconsumed
   * and unexpired. Consumption is single-use regardless of the verify outcome.
   */
  private async consumeChallenge(
    challenge: string,
    type: WebauthnChallengeRow['type'],
    now: Date,
    userId?: string,
  ): Promise<WebauthnChallengeRow> {
    const conditions = [
      eq(webauthnChallenges.challengeHash, sha256Hex(challenge)),
      eq(webauthnChallenges.type, type),
      isNull(webauthnChallenges.consumedAt),
      gt(webauthnChallenges.expiresAt, now),
    ];
    if (userId !== undefined) conditions.push(eq(webauthnChallenges.userId, userId));

    const [row] = await this.db
      .update(webauthnChallenges)
      .set({ consumedAt: now })
      .where(and(...conditions))
      .returning();
    if (!row) {
      throw new AuthenticationError('Unknown or expired challenge');
    }
    return row;
  }

  /**
   * Options for an unknown email, shaped like the real thing: a genuine
   * challenge (stored userless) and a plausible credential list. Verification
   * of any assertion against them fails with the generic error.
   */
  private async issueDecoyAuthenticationOptions(
    now: Date,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      allowCredentials: [{ id: randomBytes(32).toString('base64url'), transports: ['internal'] }],
      userVerification: 'required',
    });
    await this.storeChallenge(options.challenge, 'authentication', null, now);
    return options;
  }
}

/** Pull the challenge out of the client data; the server row proves we issued it. */
function extractClientChallenge(clientDataJSON: string): string {
  try {
    const parsed = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')) as {
      challenge?: unknown;
    };
    if (typeof parsed.challenge !== 'string' || parsed.challenge.length === 0) {
      throw new Error('Client data carries no challenge');
    }
    return parsed.challenge;
  } catch {
    throw new AuthenticationError('Malformed client data');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
