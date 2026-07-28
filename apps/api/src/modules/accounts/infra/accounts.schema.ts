import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../../identity/infra/identity.schema';
import { ledgerAccounts } from '../../ledger/infra/ledger.schema';

/** Account lifecycle. Phase 1 provisions `active`; transitions arrive later. */
export const accountStatusEnum = pgEnum('account_status', ['active', 'suspended', 'closed']);

/**
 * A customer banking account: the organizing entity a user holds. Phase 1
 * provisions exactly one EUR account per user on `kyc.approved`; the unique
 * `user_id` index enforces that invariant and is the idempotency backstop for
 * at-least-once outbox delivery. No IBAN yet (Phase 2 assigns one).
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: accountStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userUniq: uniqueIndex('accounts_user_uniq').on(table.userId),
  }),
);

/**
 * A currency-specific balance holder within an account, backed 1:1 by a ledger
 * account (`wallet:<walletId>`, liability). The wallet holds no balance column —
 * the authoritative balance is the ledger `balances` projection (ADR-0019).
 * Phase 1 creates a single EUR wallet; multi-currency wallets arrive in Phase 4,
 * which the (account, currency) uniqueness already anticipates.
 */
export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    currency: text('currency').notNull(),
    /** The backing double-entry ledger account (system of record for the balance). */
    ledgerAccountId: uuid('ledger_account_id')
      .notNull()
      .references(() => ledgerAccounts.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ledgerAccountUniq: uniqueIndex('wallets_ledger_account_uniq').on(table.ledgerAccountId),
    accountCurrencyUniq: uniqueIndex('wallets_account_currency_uniq').on(
      table.accountId,
      table.currency,
    ),
    accountIdx: index('wallets_account_idx').on(table.accountId),
  }),
);

export type AccountRow = typeof accounts.$inferSelect;
export type WalletRow = typeof wallets.$inferSelect;
