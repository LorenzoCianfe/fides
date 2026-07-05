import { ConflictError, ErrorCode, IdempotencyConflictError, InternalError } from '@fides/domain';
import { and, eq } from 'drizzle-orm';
import type { DatabaseTx } from '../../database/db.types';
import { idempotencyKeys } from './idempotency.schema';

/** How long a stored idempotency result remains replayable. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotencyContext {
  readonly actorId: string;
  readonly key: string;
  /** Hash of the canonical request; a mismatch on the same key is a conflict. */
  readonly fingerprint: string;
  readonly operation: string;
}

export type IdempotencyClaim =
  | { readonly claimed: true }
  | { readonly claimed: false; readonly responseStatus: number; readonly responseBody: unknown };

/**
 * Claim an idempotency key inside the caller's transaction.
 *
 * The first request inserts a `pending` row and receives `{ claimed: true }`.
 * Concurrent duplicates block on the primary key until this transaction commits,
 * then observe the `completed` row and receive its stored response to replay. A
 * key reused with a different request fingerprint is a conflict.
 */
export async function claimIdempotencyKey(
  tx: DatabaseTx,
  ctx: IdempotencyContext,
  now: Date,
): Promise<IdempotencyClaim> {
  const inserted = await tx
    .insert(idempotencyKeys)
    .values({
      actorId: ctx.actorId,
      key: ctx.key,
      requestFingerprint: ctx.fingerprint,
      operation: ctx.operation,
      status: 'pending',
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
    })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });

  if (inserted.length === 1) return { claimed: true };

  const [row] = await tx
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.actorId, ctx.actorId), eq(idempotencyKeys.key, ctx.key)))
    .limit(1);

  if (!row) {
    throw new InternalError('Idempotency row missing after an insert conflict', { key: ctx.key });
  }
  if (row.requestFingerprint !== ctx.fingerprint) {
    throw new IdempotencyConflictError('Idempotency key reused with a different request', {
      key: ctx.key,
      operation: ctx.operation,
    });
  }
  if (row.status !== 'completed' || row.responseStatus === null) {
    throw new ConflictError(
      'A request with this idempotency key is already in progress',
      { key: ctx.key },
      ErrorCode.CONFLICT,
    );
  }
  return { claimed: false, responseStatus: row.responseStatus, responseBody: row.responseBody };
}

/** Store the canonical response and mark the claimed key completed. */
export async function completeIdempotencyKey(
  tx: DatabaseTx,
  ctx: Pick<IdempotencyContext, 'actorId' | 'key'>,
  responseStatus: number,
  responseBody: unknown,
): Promise<void> {
  await tx
    .update(idempotencyKeys)
    .set({ status: 'completed', responseStatus, responseBody })
    .where(and(eq(idempotencyKeys.actorId, ctx.actorId), eq(idempotencyKeys.key, ctx.key)));
}
