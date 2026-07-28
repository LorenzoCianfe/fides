import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadEnv } from './config/env';

/**
 * Throttling exercised against a dedicated app instance with the kill-switch
 * ON (the main HTTP suite runs with it off so repeated requests from one IP
 * do not interfere across tests).
 */

let app: INestApplication;

beforeAll(async () => {
  process.env.DATABASE_URL = inject('databaseUrl');
  process.env.SCHEDULERS_ENABLED = 'false';
  process.env.THROTTLE_ENABLED = 'true';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app, loadEnv());
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe('auth rate limiting (integration)', () => {
  it('throttles resend-verification after its per-IP budget and renders RATE_LIMITED', async () => {
    const server = app.getHttpServer();
    const body = { email: 'ghost@example.com' };

    for (let attempt = 0; attempt < 3; attempt++) {
      await request(server).post('/v1/auth/resend-verification').send(body).expect(202);
    }

    const limited = await request(server)
      .post('/v1/auth/resend-verification')
      .send(body)
      .expect(429);
    expect(limited.body).toMatchObject({
      code: 'RATE_LIMITED',
      category: 'rate_limited',
    });
    expect(limited.body.correlationId).toBeTruthy();
  });
});
