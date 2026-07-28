import { AuthenticationError, type EventClock, type IdGenerator } from '@fides/domain';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { DbExecutor } from '../../../database/db.types';
import { stableStringify } from '../../../shared/crypto/canonical';
import { generateToken, sha256Hex } from '../../../shared/crypto/secrets';
import { scaGrants } from '../infra/auth.schema';

/** How long a verified step-up grant stays consumable. */
export const SCA_GRANT_TTL_MS = 5 * 60 * 1000;
export const SCA_GRANT_TOKEN_PREFIX = 'fsg';

/** A sensitive action to be authorized under PSD2 dynamic linking (ADR-0021). */
export interface ScaAction {
  /** Stable action discriminator, e.g. `p2p_transfer`. */
  readonly type: string;
  /** The linked parameters the user is confirming (amount, currency, payee, ...). */
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Canonical hash binding a challenge and grant to the exact action they authorize. */
export function computeActionHash(action: ScaAction): string {
  return sha256Hex(stableStringify({ type: action.type, payload: action.payload }));
}

export interface IssuedScaGrant {
  /** Opaque single-use grant token; only its SHA-256 is stored. */
  readonly grant: string;
  readonly actionHash: string;
  readonly expiresAt: Date;
}

/** Issue a single-use grant bound to (user, session, action hash). */
export async function issueScaGrant(
  executor: DbExecutor,
  ids: IdGenerator,
  clock: EventClock,
  params: { readonly userId: string; readonly sessionId: string; readonly actionHash: string },
): Promise<IssuedScaGrant> {
  const grant = generateToken(SCA_GRANT_TOKEN_PREFIX);
  const expiresAt = new Date(clock.now().getTime() + SCA_GRANT_TTL_MS);
  await executor.insert(scaGrants).values({
    id: ids.next(),
    userId: params.userId,
    sessionId: params.sessionId,
    actionHash: params.actionHash,
    tokenHash: sha256Hex(grant),
    expiresAt,
  });
  return { grant, actionHash: params.actionHash, expiresAt };
}

/**
 * Atomically consume a grant for the action being executed (single use). The
 * grant must belong to the acting user and session and match the recomputed
 * action hash — the enforcement half of dynamic linking, to be called inside
 * the money path's transaction (Slice 5).
 */
export async function consumeScaGrant(
  executor: DbExecutor,
  params: {
    readonly userId: string;
    readonly sessionId: string;
    readonly grant: string;
    readonly actionHash: string;
    readonly now: Date;
  },
): Promise<void> {
  const consumed = await executor
    .update(scaGrants)
    .set({ consumedAt: params.now })
    .where(
      and(
        eq(scaGrants.tokenHash, sha256Hex(params.grant)),
        eq(scaGrants.userId, params.userId),
        eq(scaGrants.sessionId, params.sessionId),
        eq(scaGrants.actionHash, params.actionHash),
        isNull(scaGrants.consumedAt),
        gt(scaGrants.expiresAt, params.now),
      ),
    )
    .returning({ id: scaGrants.id });
  if (consumed.length === 0) {
    throw new AuthenticationError('Step-up authentication required for this action');
  }
}
