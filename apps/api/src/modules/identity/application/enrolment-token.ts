import { AuthenticationError, type EventClock, type IdGenerator } from '@fides/domain';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { DbExecutor } from '../../../database/db.types';
import { generateToken, sha256Hex } from '../../../shared/crypto/secrets';
import { enrolmentTokens } from '../infra/auth.schema';

export const ENROLMENT_TOKEN_TTL_MS = 15 * 60 * 1000;
export const ENROLMENT_TOKEN_PREFIX = 'fet';

/**
 * Issue a one-time enrolment token proving email control for the user's first
 * passkey registration. The plaintext is returned exactly once; only its
 * SHA-256 is stored.
 */
export async function issueEnrolmentToken(
  executor: DbExecutor,
  ids: IdGenerator,
  clock: EventClock,
  userId: string,
): Promise<string> {
  const token = generateToken(ENROLMENT_TOKEN_PREFIX);
  await executor.insert(enrolmentTokens).values({
    id: ids.next(),
    userId,
    tokenHash: sha256Hex(token),
    expiresAt: new Date(clock.now().getTime() + ENROLMENT_TOKEN_TTL_MS),
  });
  return token;
}

/** Non-consuming validity check, used when issuing registration options. */
export async function assertEnrolmentTokenValid(
  executor: DbExecutor,
  userId: string,
  token: string,
  now: Date,
): Promise<void> {
  const [row] = await executor
    .select({ id: enrolmentTokens.id })
    .from(enrolmentTokens)
    .where(enrolmentTokenIsValid(userId, token, now))
    .limit(1);
  if (!row) throw new AuthenticationError('Invalid or expired enrolment token');
}

/** Atomically consume the token (single use); throws when nothing was consumable. */
export async function consumeEnrolmentToken(
  executor: DbExecutor,
  userId: string,
  token: string,
  now: Date,
): Promise<void> {
  const consumed = await executor
    .update(enrolmentTokens)
    .set({ consumedAt: now })
    .where(enrolmentTokenIsValid(userId, token, now))
    .returning({ id: enrolmentTokens.id });
  if (consumed.length === 0) {
    throw new AuthenticationError('Invalid or expired enrolment token');
  }
}

function enrolmentTokenIsValid(userId: string, token: string, now: Date) {
  return and(
    eq(enrolmentTokens.tokenHash, sha256Hex(token)),
    eq(enrolmentTokens.userId, userId),
    isNull(enrolmentTokens.consumedAt),
    gt(enrolmentTokens.expiresAt, now),
  );
}
