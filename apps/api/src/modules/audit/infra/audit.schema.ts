import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Who performed the action: an authenticated customer, a back-office operator
 * (ADR-0025), or the platform itself.
 */
export const auditActorEnum = pgEnum('audit_actor_type', ['user', 'system', 'admin']);

/**
 * Append-only, hash-chained audit trail (ADR-0024): one row per sensitive
 * action, tamper-evident and separate from mutable application state.
 *
 * Each row commits inside the audited action's own transaction, so an action
 * cannot exist without its audit. `seq` is a gap-free order assigned under an
 * advisory lock; `prevHash` links to the previous row's `hash`, and `hash` is
 * `sha256(prevHash + canonical(record))` over the immutable business fields, so
 * any out-of-band edit or deletion breaks the chain and is caught by
 * verification. The same `fides_forbid_mutation` triggers as the ledger reject
 * UPDATE/DELETE at the database, and the retention sweeper never touches it.
 *
 * The record holds internal references only — user, wallet, and journal-entry
 * ids, amounts, and action hashes — never raw PII, because the trail is
 * immutable and un-erasable (GDPR minimization). `before`/`after` carry state
 * only for mutations of mutable rows (e.g. a session revocation); a money move
 * targets the already-immutable journal entry and needs neither.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    /** Gap-free chain position; row 0 is genesis. Assigned under the append lock. */
    seq: bigint('seq', { mode: 'number' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    actorType: auditActorEnum('actor_type').notNull(),
    /** The acting user, or NULL for platform/system actions (e.g. provisioning). */
    actorId: uuid('actor_id'),
    /** Stable, namespaced action discriminator, e.g. `p2p_transfer.executed`. */
    action: text('action').notNull(),
    /** Target resource kind and id, e.g. `journal_entry` / `<entryId>`. */
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    /** Prior state of a mutated mutable row; NULL for creations and money moves. */
    before: jsonb('before'),
    /** New state of a mutated mutable row, or the created resource's salient fields. */
    after: jsonb('after'),
    /** Correlation id threaded from the request; NULL for system/outbox actions. */
    correlationId: text('correlation_id'),
    metadata: jsonb('metadata'),
    /** Previous row's hash (64 zero hex chars for genesis). */
    prevHash: text('prev_hash').notNull(),
    /** sha256(prevHash + canonical(record)); the chain link and integrity seal. */
    hash: text('hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Structural anti-fork guards: even if the append lock were bypassed, two
    // rows could not share a position, predecessor, or hash.
    seqUniq: uniqueIndex('audit_log_seq_uniq').on(table.seq),
    prevHashUniq: uniqueIndex('audit_log_prev_hash_uniq').on(table.prevHash),
    hashUniq: uniqueIndex('audit_log_hash_uniq').on(table.hash),
    actorIdx: index('audit_log_actor_idx').on(table.actorType, table.actorId),
    correlationIdx: index('audit_log_correlation_idx').on(table.correlationId),
  }),
);

export type AuditLogRow = typeof auditLog.$inferSelect;

/**
 * Periodic signed statements of the chain's head (ADR-0031), closing the
 * truncation gap ADR-0024 deferred: the chain proves nothing it *contains* was
 * altered, but deleting the newest rows leaves a shorter chain that still
 * verifies perfectly.
 *
 * **This table is convenience, not the control.** The same attacker who can
 * truncate `audit_log` can delete these rows alongside it. What it buys is
 * automatic, cheap detection on every `verify()` call, without an operator
 * having to fetch anything. The guarantee lives in the copy of each anchor
 * emitted to the process log, which leaves the host and cannot be retracted —
 * see `AuditAnchorPublisher`.
 *
 * Deliberately NOT hash-chained itself. Anchors are independent signed claims,
 * each verifiable alone; chaining them would mean losing every later anchor when
 * an early one was deleted, which is the opposite of what is wanted here.
 */
export const auditAnchors = pgTable(
  'audit_anchors',
  {
    id: uuid('id').primaryKey(),
    /** The chain position this anchor attests to. */
    seq: bigint('seq', { mode: 'number' }).notNull(),
    /** The `audit_log.hash` at that position, as it stood when signed. */
    hash: text('hash').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    /** The exact canonical string that was signed; kept so verification never re-derives it. */
    payload: text('payload').notNull(),
    /** Self-describing `fsig$v1$keyId$signature`, naming the key that made it. */
    signature: text('signature').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    seqIdx: index('audit_anchors_seq_idx').on(table.seq),
    publishedIdx: index('audit_anchors_published_idx').on(table.publishedAt),
  }),
);

export type AuditAnchorRow = typeof auditAnchors.$inferSelect;
