import type { NextFunction, Request, Response } from 'express';
import { uuidv7 } from 'uuidv7';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/** Sane gateway-issued ids are honored; anything else is replaced. */
const VALID_CORRELATION_ID = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Ensures every request carries a correlation id: a well-formed inbound
 * `X-Correlation-Id` is kept, anything else is replaced with a fresh UUID v7.
 * The id is rewritten onto the request headers (so logs and the error envelope
 * read one value) and echoed on the response.
 */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers[CORRELATION_ID_HEADER];
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  const correlationId =
    candidate !== undefined && VALID_CORRELATION_ID.test(candidate) ? candidate : uuidv7();

  req.headers[CORRELATION_ID_HEADER] = correlationId;
  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  next();
}
