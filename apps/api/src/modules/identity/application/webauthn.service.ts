import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  PreconditionFailedError,
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
import {
  credentials,
  webauthnChallenges,
  type CredentialRow,
  type WebauthnChallengeRow,
} from '../infra/auth.schema';
import { users, type UserRow } from '../infra/identity.schema';
import { AuditAction, AuditResource } from '../../audit/application/audit-actions';
import { AuditService } from '../../audit/application/audit.service';
import { assertEnrolmentTokenValid, consumeEnrolmentToken } from './enrolment-token';
import { computeActionHash, issueScaGrant, type IssuedScaGrant, type ScaAction } from './sca-grant';
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

export interface StartStepUpParams {
  /** The guard-validated principal's userId. */
  readonly userId: string;
  readonly action: ScaAction;
}

export interface FinishStepUpParams extends StartStepUpParams {
  /** The guard-validated principal's sessionId; the grant is bound to it. */
  readonly sessionId: string;
  readonly response: AuthenticationResponseJSON;
  /** Correlation id from the request, recorded on the audit trail (ADR-0024). */
  readonly correlationId?: string;
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
    private readonly audit: AuditService,
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

    const newCounter = await this.verifyAssertion(
      credential,
      params.response,
      clientChallenge,
      'Authentication failed',
    );

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

  /**
   * Issue assertion options for a step-up ceremony dynamically linked to the
   * action (PSD2 SCA): the stored challenge is bound to the canonical action
   * hash, so the signed assertion authorizes exactly this action and no other.
   */
  async startStepUp(params: StartStepUpParams): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const now = this.clock.now();
    const user = await this.requireUser(params.userId);
    const userCredentials = await this.db
      .select()
      .from(credentials)
      .where(eq(credentials.userId, user.id));
    if (userCredentials.length === 0) {
      throw new PreconditionFailedError('No passkey enrolled for step-up authentication');
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

    await this.storeChallenge(
      options.challenge,
      'sca',
      user.id,
      now,
      computeActionHash(params.action),
    );
    return options;
  }

  /**
   * Verify the fresh step-up assertion against the action-bound challenge and
   * mint the single-use grant the money path will consume (ADR-0021).
   */
  async finishStepUp(params: FinishStepUpParams): Promise<IssuedScaGrant> {
    const now = this.clock.now();
    const actionHash = computeActionHash(params.action);
    const clientChallenge = extractClientChallenge(params.response.response.clientDataJSON);
    await this.consumeChallenge(clientChallenge, 'sca', now, params.userId, actionHash);

    const [credential] = await this.db
      .select()
      .from(credentials)
      .where(
        and(
          eq(credentials.credentialId, params.response.id),
          eq(credentials.userId, params.userId),
        ),
      )
      .limit(1);
    if (!credential) throw new AuthenticationError('Step-up verification failed');

    const newCounter = await this.verifyAssertion(
      credential,
      params.response,
      clientChallenge,
      'Step-up verification failed',
    );

    await this.requireUser(params.userId);

    return this.db.transaction(async (tx) => {
      await tx
        .update(credentials)
        .set({ counter: newCounter, lastUsedAt: now })
        .where(eq(credentials.id, credential.id));
      const issued = await issueScaGrant(tx, this.ids, this.clock, {
        userId: params.userId,
        sessionId: params.sessionId,
        actionHash,
      });
      // Record that SCA step-up succeeded, atomically with issuance (ADR-0024).
      // The grant token is never stored — only the action binding it authorizes.
      await this.audit.append(tx, {
        actorType: 'user',
        actorId: params.userId,
        action: AuditAction.ScaStepUpGranted,
        resourceType: AuditResource.ScaGrant,
        resourceId: actionHash,
        correlationId: params.correlationId ?? null,
        metadata: { actionType: params.action.type, sessionId: params.sessionId },
      });
      return issued;
    });
  }

  /** Verify an assertion against a stored credential; returns the new counter. */
  private async verifyAssertion(
    credential: CredentialRow,
    response: AuthenticationResponseJSON,
    expectedChallenge: string,
    failureMessage: string,
  ): Promise<number> {
    let verified: boolean;
    let newCounter: number;
    try {
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
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
      throw new AuthenticationError(failureMessage, { reason: errorMessage(error) });
    }
    if (!verified) throw new AuthenticationError(failureMessage);
    return newCounter;
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
    actionHash?: string,
  ): Promise<void> {
    await this.db.insert(webauthnChallenges).values({
      id: this.ids.next(),
      challengeHash: sha256Hex(challenge),
      type,
      userId,
      actionHash: actionHash ?? null,
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
    actionHash?: string,
  ): Promise<WebauthnChallengeRow> {
    const conditions = [
      eq(webauthnChallenges.challengeHash, sha256Hex(challenge)),
      eq(webauthnChallenges.type, type),
      isNull(webauthnChallenges.consumedAt),
      gt(webauthnChallenges.expiresAt, now),
    ];
    if (userId !== undefined) conditions.push(eq(webauthnChallenges.userId, userId));
    if (actionHash !== undefined) conditions.push(eq(webauthnChallenges.actionHash, actionHash));

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
