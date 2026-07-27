import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { inject } from 'vitest';
import * as schema from '../src/database/schema';

export type TestDatabase = PostgresJsDatabase<typeof schema>;

export interface TestDbHandle {
  readonly db: TestDatabase;
  readonly close: () => Promise<void>;
}

/** Connect to the shared test container provisioned by the global setup. */
export function createTestDb(): TestDbHandle {
  const client = postgres(inject('databaseUrl'), { max: 5 });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}

/** Truncate all tables between tests (append-only triggers do not block TRUNCATE). */
export async function resetDb(db: TestDatabase): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE transaction_history, postings, journal_entries, balances, wallets, accounts, ledger_accounts, kyc_applications, sca_grants, sessions, credentials, devices, webauthn_challenges, enrolment_tokens, email_verifications, users, audit_log, idempotency_keys, outbox RESTART IDENTITY CASCADE`,
  );
}
