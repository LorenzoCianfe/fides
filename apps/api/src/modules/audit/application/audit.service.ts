import type { EventClock, IdGenerator } from '@fides/domain';
import { asc, desc, sql } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../../database/db.types';
import { stableStringify } from '../../../shared/crypto/canonical';
import { sha256Hex } from '../../../shared/crypto/secrets';
import { auditLog, type AuditLogRow } from '../infra/audit.schema';

/** The predecessor hash of the genesis (seq 0) row: 64 zero hex characters. */
export const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * Transaction-scoped advisory-lock key that serializes appends to the single
 * global chain (ADR-0024). Acquired inside the caller's transaction as late as
 * possible, so it is held only for the remainder of that transaction.
 */
const AUDIT_CHAIN_LOCK_KEY = 741_852_963;

export type AuditActorType = 'user' | 'system';

/** A JSON snapshot for `before`/`after`/`metadata`: string/boolean-valued only. */
export type AuditJson = Record<string, unknown>;

export interface AuditRecordInput {
  readonly actorType: AuditActorType;
  /** The acting user, or null for platform/system actions. */
  readonly actorId: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Prior state of a mutated mutable row; omit for creations and money moves. */
  readonly before?: AuditJson | null;
  /** New state of a mutated mutable row, or the created resource's salient fields. */
  readonly after?: AuditJson | null;
  readonly correlationId?: string | null;
  readonly metadata?: AuditJson | null;
}

/**
 * The immutable business fields in the exact shape that is hashed. `occurredAt`
 * is epoch milliseconds (a bigint column round-trips exactly, unlike ISO string
 * formatting); `before`/`after`/`metadata` are canonicalized by `stableStringify`,
 * whose recursive key-sort makes the hash invariant to jsonb key reordering.
 */
interface AuditRecordCore {
  readonly id: string;
  readonly seq: number;
  readonly occurredAtMs: number;
  readonly actorType: AuditActorType;
  readonly actorId: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly correlationId: string | null;
  readonly metadata: unknown;
}

export interface AuditVerificationResult {
  readonly ok: boolean;
  readonly count: number;
  /** The seq at which the chain first breaks, or null when intact. */
  readonly brokenAtSeq: number | null;
}

/** The row hash: `sha256(prevHash + canonical(core))`. */
export function computeAuditHash(prevHash: string, core: AuditRecordCore): string {
  return sha256Hex(prevHash + stableStringify(core));
}

/** Project a stored row onto the exact immutable shape that is hashed. */
export function auditRecordCore(row: AuditLogRow): AuditRecordCore {
  return {
    id: row.id,
    seq: row.seq,
    occurredAtMs: row.occurredAt.getTime(),
    actorType: row.actorType,
    actorId: row.actorId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    before: row.before,
    after: row.after,
    correlationId: row.correlationId,
    metadata: row.metadata,
  };
}

/**
 * Pure verification of a hash-chained audit trail (ADR-0024). Rows (ordered by
 * `seq`) must be gap-free from genesis, each `prevHash` must link to the prior
 * row's `hash`, and each `hash` must recompute from the canonical record.
 * Returns the first break. Pure so break detection is unit-testable without
 * fighting the append-only trigger.
 *
 * Note: this detects any modification or removal of a non-tail record; deletion
 * of the tail (truncation) is not detectable from the chain alone and would need
 * an external high-water anchor (deferred, see ADR-0024).
 */
export function verifyAuditChain(rows: readonly AuditLogRow[]): AuditVerificationResult {
  let expectedPrev = GENESIS_PREV_HASH;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const linksToPrevious = row.prevHash === expectedPrev;
    const positionIsContiguous = row.seq === index;
    const hashRecomputes = row.hash === computeAuditHash(row.prevHash, auditRecordCore(row));
    if (!linksToPrevious || !positionIsContiguous || !hashRecomputes) {
      return { ok: false, count: rows.length, brokenAtSeq: row.seq };
    }
    expectedPrev = row.hash;
  }
  return { ok: true, count: rows.length, brokenAtSeq: null };
}

/**
 * Writes the append-only, hash-chained audit trail (ADR-0024). Every sensitive
 * action calls {@link append} inside its own transaction, so the record commits
 * atomically with the action — no action without its audit, no audit without its
 * action. {@link verify} recomputes the chain, the analogue of the ledger's
 * reconciliation invariants.
 */
export class AuditService {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
    private readonly clock: EventClock,
  ) {}

  /**
   * Append one record to the global chain within the caller's transaction. Takes
   * an advisory lock (serializing appends and preventing a fork), reads the tail,
   * links to it, and inserts. Must be called inside a transaction — the lock is
   * transaction-scoped, and the record must commit or roll back with the action.
   */
  async append(executor: DbExecutor, input: AuditRecordInput): Promise<void> {
    await executor.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`);

    const [tail] = await executor
      .select({ seq: auditLog.seq, hash: auditLog.hash })
      .from(auditLog)
      .orderBy(desc(auditLog.seq))
      .limit(1);

    const seq = tail ? tail.seq + 1 : 0;
    const prevHash = tail ? tail.hash : GENESIS_PREV_HASH;
    const occurredAt = this.clock.now();

    const core: AuditRecordCore = {
      id: this.ids.next(),
      seq,
      occurredAtMs: occurredAt.getTime(),
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      before: input.before ?? null,
      after: input.after ?? null,
      correlationId: input.correlationId ?? null,
      metadata: input.metadata ?? null,
    };
    const hash = computeAuditHash(prevHash, core);

    await executor.insert(auditLog).values({
      id: core.id,
      seq: core.seq,
      occurredAt,
      actorType: core.actorType,
      actorId: core.actorId,
      action: core.action,
      resourceType: core.resourceType,
      resourceId: core.resourceId,
      before: core.before,
      after: core.after,
      correlationId: core.correlationId,
      metadata: core.metadata,
      prevHash,
      hash,
    });
  }

  /** Load the whole chain in order and verify its integrity (ADR-0024). */
  async verify(): Promise<AuditVerificationResult> {
    const rows = await this.db.select().from(auditLog).orderBy(asc(auditLog.seq));
    return verifyAuditChain(rows);
  }
}
