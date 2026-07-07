import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ENV, type Env } from '../config/env';
import type { Database } from './db.types';
import * as schema from './schema';

/** DI token for the Drizzle database handle. */
export const DRIZZLE = Symbol('DRIZZLE');

/** DI token for the underlying postgres-js client (owned by this module). */
const PG_CLIENT = Symbol('PG_CLIENT');

/** Closes the connection pool on shutdown so the process can exit cleanly. */
@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PG_CLIENT) private readonly client: postgres.Sql) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }
}

/**
 * Provides the Drizzle handle. Since Wave C the API serves stateful endpoints,
 * so a missing DATABASE_URL fails the boot loudly; the Phase 0 property of
 * booting without a database no longer holds.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_CLIENT,
      inject: [ENV],
      useFactory: (env: Env): postgres.Sql => {
        if (!env.DATABASE_URL) {
          throw new Error(
            'DATABASE_URL is required: the API serves stateful endpoints. ' +
              'Start the local stack (pnpm stack:up) and set DATABASE_URL.',
          );
        }
        return postgres(env.DATABASE_URL, { max: 10 });
      },
    },
    {
      provide: DRIZZLE,
      inject: [PG_CLIENT],
      useFactory: (client: postgres.Sql): Database => drizzle(client, { schema }),
    },
    DatabaseLifecycle,
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
