import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Idempotency keys for money-moving operations.
 *
 * A key is scoped per actor (`(actor_id, key)`), claimed inside the same
 * transaction as the write it guards (exactly-once, restart-safe). A completed
 * row stores the canonical response so a retry replays the original result; a
 * reused key with a different request fingerprint is a conflict.
 */

export const idempotencyStatusEnum = pgEnum('idempotency_status', ['pending', 'completed']);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    actorId: uuid('actor_id').notNull(),
    key: text('key').notNull(),
    /** Hash of the canonical request (method, path, body) to detect key reuse. */
    requestFingerprint: text('request_fingerprint').notNull(),
    operation: text('operation').notNull(),
    status: idempotencyStatusEnum('status').notNull().default('pending'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.actorId, table.key] }),
  }),
);

export type IdempotencyRow = typeof idempotencyKeys.$inferSelect;
