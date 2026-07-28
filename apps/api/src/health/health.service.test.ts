import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env';
import { HealthService } from './health.service';

// Parse through the schema so new env fields with defaults never break this test.
const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' });

describe('HealthService', () => {
  it('reports ok with a lowercased service name', () => {
    const result = new HealthService(env).check();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('fides-api');
    expect(result.version).toBe('0.1.0');
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });
});
