import { ErrorCategory, ErrorCode } from './error-codes';

export interface ErrorContext {
  readonly [key: string]: unknown;
}

/** The wire shape returned to clients for any operational error. */
export interface ErrorResponseBody {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly message: string;
  readonly details?: ErrorContext;
  readonly correlationId?: string;
}

export interface DomainErrorOptions {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly httpStatus: number;
  readonly message: string;
  readonly details?: ErrorContext;
  readonly cause?: unknown;
}

/**
 * Base class for every expected, typed error in the platform.
 *
 * Operational errors carry a stable code, a category, an HTTP status for the
 * inbound adapter, and optional structured details. They are safe to surface;
 * unexpected faults should be wrapped in {@link InternalError} instead.
 */
export abstract class DomainError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly httpStatus: number;
  readonly details?: ErrorContext;
  /** Expected errors are safe to surface to clients. */
  readonly isOperational: boolean = true;

  protected constructor(options: DomainErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code;
    this.category = options.category;
    this.httpStatus = options.httpStatus;
    this.details = options.details;
    // Preserve the prototype chain for reliable `instanceof` after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Serialize to the client-facing wire shape. */
  toResponse(correlationId?: string): ErrorResponseBody {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
      ...(correlationId !== undefined ? { correlationId } : {}),
    };
  }
}

/** True if `value` is any {@link DomainError}. */
export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

// --- Generic errors ---------------------------------------------------------

export class ValidationError extends DomainError {
  constructor(
    message = 'Validation failed',
    details?: ErrorContext,
    code: string = ErrorCode.VALIDATION_FAILED,
  ) {
    super({ code, category: ErrorCategory.Validation, httpStatus: 400, message, details });
  }
}

export class AuthenticationError extends DomainError {
  constructor(message = 'Authentication required', details?: ErrorContext) {
    super({
      code: ErrorCode.UNAUTHENTICATED,
      category: ErrorCategory.Authentication,
      httpStatus: 401,
      message,
      details,
    });
  }
}

export class AuthorizationError extends DomainError {
  constructor(message = 'Forbidden', details?: ErrorContext) {
    super({
      code: ErrorCode.FORBIDDEN,
      category: ErrorCategory.Authorization,
      httpStatus: 403,
      message,
      details,
    });
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Resource not found', details?: ErrorContext) {
    super({
      code: ErrorCode.NOT_FOUND,
      category: ErrorCategory.NotFound,
      httpStatus: 404,
      message,
      details,
    });
  }
}

export class ConflictError extends DomainError {
  constructor(message = 'Conflict', details?: ErrorContext, code: string = ErrorCode.CONFLICT) {
    super({ code, category: ErrorCategory.Conflict, httpStatus: 409, message, details });
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor(
    message = 'Idempotency key already used with a different request',
    details?: ErrorContext,
  ) {
    super({
      code: ErrorCode.IDEMPOTENCY_CONFLICT,
      category: ErrorCategory.Conflict,
      httpStatus: 409,
      message,
      details,
    });
  }
}

export class PreconditionFailedError extends DomainError {
  constructor(message = 'Precondition failed', details?: ErrorContext) {
    super({
      code: ErrorCode.PRECONDITION_FAILED,
      category: ErrorCategory.PreconditionFailed,
      httpStatus: 412,
      message,
      details,
    });
  }
}

export class RateLimitError extends DomainError {
  constructor(message = 'Too many requests', details?: ErrorContext) {
    super({
      code: ErrorCode.RATE_LIMITED,
      category: ErrorCategory.RateLimited,
      httpStatus: 429,
      message,
      details,
    });
  }
}

export class UpstreamPortError extends DomainError {
  constructor(message = 'Upstream dependency failed', details?: ErrorContext, cause?: unknown) {
    super({
      code: ErrorCode.UPSTREAM_PORT_ERROR,
      category: ErrorCategory.UpstreamPort,
      httpStatus: 502,
      message,
      details,
      cause,
    });
  }
}

export class InternalError extends DomainError {
  override readonly isOperational: boolean = false;
  constructor(message = 'Internal error', details?: ErrorContext, cause?: unknown) {
    super({
      code: ErrorCode.INTERNAL_ERROR,
      category: ErrorCategory.Internal,
      httpStatus: 500,
      message,
      details,
      cause,
    });
  }
}

// --- Money / domain errors --------------------------------------------------

export class CurrencyMismatchError extends DomainError {
  constructor(expected: string, actual: string) {
    super({
      code: ErrorCode.CURRENCY_MISMATCH,
      category: ErrorCategory.Validation,
      httpStatus: 400,
      message: `Currency mismatch: expected ${expected}, received ${actual}`,
      details: { expected, actual },
    });
  }
}

export class UnknownCurrencyError extends DomainError {
  constructor(currency: string) {
    super({
      code: ErrorCode.UNKNOWN_CURRENCY,
      category: ErrorCategory.Validation,
      httpStatus: 400,
      message: `Unknown currency: ${currency}`,
      details: { currency },
    });
  }
}

export class MoneyPrecisionError extends DomainError {
  constructor(message: string, details?: ErrorContext) {
    super({
      code: ErrorCode.MONEY_PRECISION,
      category: ErrorCategory.Validation,
      httpStatus: 400,
      message,
      details,
    });
  }
}
