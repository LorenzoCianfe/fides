import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Transactional outbox. Domain events are written here in the same transaction
 * as the state change that produced them; a dispatcher relays pending rows.
 * (Ledger tables arrive in Phase 1 — this is the only table in Phase 0.)
 */
export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey(),
    type: text('type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    correlationId: text('correlation_id'),
    causationId: text('causation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('outbox_status_idx').on(table.status),
    aggregateIdx: index('outbox_aggregate_idx').on(table.aggregateType, table.aggregateId),
  }),
);
