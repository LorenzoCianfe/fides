import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestDb, resetDb, type TestDatabase } from '../test/db';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadEnv } from './config/env';
import { webauthnChallenges } from './modules/identity/infra/auth.schema';
import { UuidV7Generator } from './shared/ids/uuid-v7';

/**
 * Proves the background intervals are actually armed in a running app: an
 * already-dead security row disappears without any request touching it.
 */

const ids = new UuidV7Generator();
const { db, close: closeDb } = createTestDb();

let app: INestApplication;

beforeAll(async () => {
  process.env.DATABASE_URL = inject('databaseUrl');
  process.env.SCHEDULERS_ENABLED = 'true';
  process.env.THROTTLE_ENABLED = 'false';
  process.env.OUTBOX_DISPATCH_INTERVAL_MS = '100';
  process.env.CLEANUP_INTERVAL_MS = '150';

  await resetDb(db as TestDatabase);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app, loadEnv());
  await app.init();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('background schedulers (integration)', () => {
  it('sweeps dead security rows on the armed interval', async () => {
    await db.insert(webauthnChallenges).values({
      id: ids.next(),
      challengeHash: 'dead-row-hash',
      type: 'authentication',
      userId: null,
      expiresAt: new Date(Date.now() - 60_000),
      createdAt: new Date(Date.now() - 120_000),
    });

    const deadline = Date.now() + 10_000;
    let remaining = 1;
    while (remaining > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      remaining = (await db.select().from(webauthnChallenges)).length;
    }
    expect(remaining).toBe(0);
  });
});
