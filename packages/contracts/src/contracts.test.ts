import { describe, expect, it } from 'vitest';
import {
  createOpenApiRegistry,
  CurrencyCodeSchema,
  ErrorResponseSchema,
  generateOpenApiDocument,
  HealthResponseSchema,
  MoneySchema,
} from './index';

describe('MoneySchema', () => {
  it('accepts integer minor units as a string', () => {
    expect(MoneySchema.parse({ amount: '1050', currency: 'EUR' })).toEqual({
      amount: '1050',
      currency: 'EUR',
    });
    expect(MoneySchema.parse({ amount: '-42', currency: 'JPY' }).amount).toBe('-42');
  });

  it('rejects decimals and unknown currencies', () => {
    expect(MoneySchema.safeParse({ amount: '10.50', currency: 'EUR' }).success).toBe(false);
    expect(MoneySchema.safeParse({ amount: '1050', currency: 'XXX' }).success).toBe(false);
  });
});

describe('shared schemas', () => {
  it('derives the currency enum from the domain registry', () => {
    expect(CurrencyCodeSchema.options).toContain('EUR');
    expect(CurrencyCodeSchema.options).toContain('JPY');
  });

  it('validates the error envelope', () => {
    const parsed = ErrorResponseSchema.parse({
      code: 'NOT_FOUND',
      category: 'not_found',
      message: 'missing',
    });
    expect(parsed.code).toBe('NOT_FOUND');
  });

  it('validates the health response', () => {
    const ok = HealthResponseSchema.safeParse({
      status: 'ok',
      service: 'fides-api',
      version: '0.1.0',
      uptimeSeconds: 1,
      timestamp: '2026-07-04T12:00:00.000Z',
    });
    expect(ok.success).toBe(true);
  });
});

describe('OpenAPI generation', () => {
  it('emits registered schemas as components', () => {
    const registry = createOpenApiRegistry();
    registry.register('Money', MoneySchema);
    registry.register('ErrorResponse', ErrorResponseSchema);
    const doc = generateOpenApiDocument(registry, { title: 'Fides API', version: '0.1.0' });
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.components?.schemas?.Money).toBeDefined();
    expect(doc.components?.schemas?.ErrorResponse).toBeDefined();
  });
});
