import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Ledger persistence schema (system of record).
 *
 * `ledger_accounts`, `journal_entries`, and `postings` are append-only — a
 * migration installs triggers that forbid UPDATE/DELETE on them (see
 * `0002_ledger_append_only.sql`). `balances` is the synchronously-maintained
 * balance projection (ADR-0019) and is therefore mutable.
 */

export const accountTypeEnum = pgEnum('account_type', [
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
]);

export const postingDirectionEnum = pgEnum('posting_direction', ['debit', 'credit']);

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid('id').primaryKey(),
    type: accountTypeEnum('type').notNull(),
    currency: text('currency').notNull(),
    /** Stable machine code, e.g. `wallet:<walletId>` or `system:settlement`. */
    code: text('code').notNull(),
    system: boolean('system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codeUnique: uniqueIndex('ledger_accounts_code_uniq').on(table.code),
  }),
);

export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').primaryKey(),
  /** Domain reason for the entry, e.g. `transfer` or `funding`. */
  type: text('type').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  correlationId: text('correlation_id'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const postings = pgTable(
  'postings',
  {
    id: uuid('id').primaryKey(),
    journalEntryId: uuid('journal_entry_id')
      .notNull()
      .references(() => journalEntries.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id),
    direction: postingDirectionEnum('direction').notNull(),
    /** Strictly-positive integer minor units. */
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    /** Stable order of this posting within its entry. */
    position: smallint('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    entryIdx: index('postings_entry_idx').on(table.journalEntryId),
    accountIdx: index('postings_account_idx').on(table.accountId, table.id),
  }),
);

/**
 * Balance projection: one row per ledger account, holding the account's natural
 * balance in integer minor units. Maintained in the same transaction as the
 * postings that change it (ADR-0019); never the source of truth (that is the
 * sum of postings), but authoritative for funds checks under a row lock.
 */
export const balances = pgTable('balances', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => ledgerAccounts.id),
  balance: numeric('balance', { precision: 38, scale: 0 }).notNull().default('0'),
  currency: text('currency').notNull(),
  version: bigint('version', { mode: 'bigint' })
    .notNull()
    .default(sql`0`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type LedgerAccountRow = typeof ledgerAccounts.$inferSelect;
export type JournalEntryRow = typeof journalEntries.$inferSelect;
export type PostingRow = typeof postings.$inferSelect;
export type BalanceRow = typeof balances.$inferSelect;
