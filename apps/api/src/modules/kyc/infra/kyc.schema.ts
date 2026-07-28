import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from '../../identity/infra/identity.schema';

export const kycStatusEnum = pgEnum('kyc_status', ['pending', 'approved', 'rejected', 'review']);

/**
 * A KYC application per user. In development the mock adapter auto-approves; the
 * full pipeline (documents, liveness, screening) arrives in Phase 3.
 */
export const kycApplications = pgTable(
  'kyc_applications',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: kycStatusEnum('status').notNull().default('pending'),
    /** Provider-side decision reference. */
    reference: text('reference'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('kyc_applications_user_idx').on(table.userId),
  }),
);

export type KycApplicationRow = typeof kycApplications.$inferSelect;
