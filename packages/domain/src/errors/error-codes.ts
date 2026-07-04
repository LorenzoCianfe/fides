/**
 * Stable error taxonomy shared across every tier (API, clients, admin).
 *
 * Codes are string constants that never change once shipped — clients and
 * audit records may key off them. Categories drive default HTTP mapping and
 * observability grouping.
 */

export const ErrorCategory = {
  Validation: 'validation',
  Authentication: 'authentication',
  Authorization: 'authorization',
  NotFound: 'not_found',
  Conflict: 'conflict',
  RateLimited: 'rate_limited',
  PreconditionFailed: 'precondition_failed',
  UpstreamPort: 'upstream_port',
  Internal: 'internal',
} as const;

export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

export const ErrorCode = {
  // Generic
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  UPSTREAM_PORT_ERROR: 'UPSTREAM_PORT_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // Money / domain
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  UNKNOWN_CURRENCY: 'UNKNOWN_CURRENCY',
  MONEY_PRECISION: 'MONEY_PRECISION',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
