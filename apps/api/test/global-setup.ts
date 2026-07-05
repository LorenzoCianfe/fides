import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { GlobalSetupContext } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

/**
 * Boots a single ephemeral Postgres container for the whole test run, applies
 * the committed migrations (validating the real migration path), and shares the
 * connection URL with the test workers. Requires a running Docker daemon.
 */
export default async function setup({ provide }: GlobalSetupContext): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const databaseUrl = container.getConnectionUri();

  const client = postgres(databaseUrl, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  } finally {
    await client.end();
  }

  provide('databaseUrl', databaseUrl);

  return async () => {
    await container?.stop();
  };
}
