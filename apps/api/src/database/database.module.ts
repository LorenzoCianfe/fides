import { Global, Module } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ENV, type Env } from '../config/env';
import * as schema from './schema';

/** DI token for the Drizzle database handle (null when DATABASE_URL is unset). */
export const DRIZZLE = Symbol('DRIZZLE');

export type Database = PostgresJsDatabase<typeof schema> | null;

/**
 * Provides the Drizzle handle. The client connects lazily on first query, so
 * the API boots even without a database — the liveness probe stays green.
 */
@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [ENV],
      useFactory: (env: Env): Database => {
        if (!env.DATABASE_URL) return null;
        const client = postgres(env.DATABASE_URL, { max: 10 });
        return drizzle(client, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
