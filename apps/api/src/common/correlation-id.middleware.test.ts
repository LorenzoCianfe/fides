import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { CORRELATION_ID_HEADER, correlationIdMiddleware } from './correlation-id.middleware';

interface Harness {
  readonly req: Request;
  readonly res: Response;
  readonly outbound: Record<string, string>;
  readonly nextCalls: number[];
}

function run(inbound?: string | string[]): Harness {
  const headers: Record<string, string | string[] | undefined> = {};
  if (inbound !== undefined) headers[CORRELATION_ID_HEADER] = inbound;
  const outbound: Record<string, string> = {};
  const nextCalls: number[] = [];
  const req = { headers } as unknown as Request;
  const res = {
    setHeader: (name: string, value: string) => {
      outbound[name] = value;
    },
  } as unknown as Response;
  correlationIdMiddleware(req, res, () => nextCalls.push(1));
  return { req, res, outbound, nextCalls };
}

describe('correlationIdMiddleware', () => {
  it('honors a well-formed inbound id and echoes it', () => {
    const { req, outbound, nextCalls } = run('gateway-abc-123');
    expect(req.headers[CORRELATION_ID_HEADER]).toBe('gateway-abc-123');
    expect(outbound[CORRELATION_ID_HEADER]).toBe('gateway-abc-123');
    expect(nextCalls).toHaveLength(1);
  });

  it('replaces a missing id with a generated one', () => {
    const { req, outbound } = run();
    const id = req.headers[CORRELATION_ID_HEADER];
    expect(typeof id).toBe('string');
    expect((id as string).length).toBeGreaterThanOrEqual(8);
    expect(outbound[CORRELATION_ID_HEADER]).toBe(id);
  });

  it.each([
    ['too short', 'abc'],
    ['illegal characters', 'bad id with spaces'],
    ['oversized', 'x'.repeat(200)],
  ])('replaces a malformed inbound id (%s)', (_label, inbound) => {
    const { req } = run(inbound);
    expect(req.headers[CORRELATION_ID_HEADER]).not.toBe(inbound);
  });

  it('uses the first value of a repeated header', () => {
    const { req } = run(['first-valid-id', 'second-valid-id']);
    expect(req.headers[CORRELATION_ID_HEADER]).toBe('first-valid-id');
  });
});
