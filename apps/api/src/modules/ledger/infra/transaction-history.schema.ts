import {
  bigint,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { journalEntries, ledgerAccounts } from './ledger.schema';

/**
 * Denormalized per-account transaction history: one row per (account, entry).
 * A read model projected asynchronously from `ledger.entry.posted` by the outbox
 * dispatcher — rebuildable from the ledger, never a source of truth. The unique
 * (account, entry) index makes the projection idempotent under at-least-once
 * delivery.
 */
export const transactionHistory = pgTable(
  'transaction_history',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id),
    journalEntryId: uuid('journal_entry_id')
      .notNull()
      .references(() => journalEntries.id),
    entryType: text('entry_type').notNull(),
    /** Signed effect on this account's balance: + credited, − debited. */
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    balanceAfterMinor: numeric('balance_after_minor', { precision: 38, scale: 0 }).notNull(),
    currency: text('currency').notNull(),
    /** The other accounts party to the same entry. */
    counterpartyAccountIds: jsonb('counterparty_account_ids').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountEntryUniq: uniqueIndex('transaction_history_account_entry_uniq').on(
      table.accountId,
      table.journalEntryId,
    ),
    accountOccurredIdx: index('transaction_history_account_occurred_idx').on(
      table.accountId,
      table.occurredAt,
    ),
  }),
);

export type TransactionHistoryRow = typeof transactionHistory.$inferSelect;
