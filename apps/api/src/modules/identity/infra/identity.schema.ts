import {
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Onboarding → active → suspended lifecycle for a natural-person user. */
export const userStatusEnum = pgEnum('user_status', ['onboarding', 'active', 'suspended']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    /** Account identifier; stored lower-cased and unique. */
    email: text('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    status: userStatusEnum('status').notNull().default('onboarding'),
    givenName: text('given_name').notNull(),
    familyName: text('family_name').notNull(),
    dateOfBirth: date('date_of_birth').notNull(),
    phone: text('phone'),
    addressLine1: text('address_line1').notNull(),
    addressLine2: text('address_line2'),
    city: text('city').notNull(),
    postalCode: text('postal_code').notNull(),
    /** ISO 3166-1 alpha-2 country of residence. */
    country: text('country').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailUniq: uniqueIndex('users_email_uniq').on(table.email),
  }),
);

export const emailVerifications = pgTable(
  'email_verifications',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** SHA-256 of the delivered code; the plaintext is never stored. */
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('email_verifications_user_idx').on(table.userId),
  }),
);

export type UserRow = typeof users.$inferSelect;
export type EmailVerificationRow = typeof emailVerifications.$inferSelect;
