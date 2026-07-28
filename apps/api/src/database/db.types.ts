import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from './schema';

/** The Drizzle database handle, typed against the full schema. */
export type Database = PostgresJsDatabase<typeof schema>;

/** A transaction handle, as passed to a `db.transaction(async (tx) => …)` callback. */
export type DatabaseTx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Anything that can run queries: the base handle or an open transaction. */
export type DbExecutor = Database | DatabaseTx;
