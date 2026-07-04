import { describe, expect, it } from 'vitest';
import { ErrorCategory, ErrorCode } from './error-codes';
import {
  CurrencyMismatchError,
  DomainError,
  InternalError,
  isDomainError,
  NotFoundError,
  ValidationError,
} from './domain-error';

describe('DomainError hierarchy', () => {
  it('carries a code, category, and HTTP status', () => {
    const error = new NotFoundError('User not found', { userId: 'u_1' });
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(ErrorCode.NOT_FOUND);
    expect(error.category).toBe(ErrorCategory.NotFound);
    expect(error.httpStatus).toBe(404);
    expect(error.isOperational).toBe(true);
    expect(error.name).toBe('NotFoundError');
    expect(error.details).toEqual({ userId: 'u_1' });
  });

  it('marks internal errors as non-operational', () => {
    const error = new InternalError();
    expect(error.isOperational).toBe(false);
    expect(error.httpStatus).toBe(500);
  });

  it('builds money-specific errors with structured details', () => {
    const error = new CurrencyMismatchError('EUR', 'USD');
    expect(error.code).toBe(ErrorCode.CURRENCY_MISMATCH);
    expect(error.details).toEqual({ expected: 'EUR', actual: 'USD' });
  });

  it('serializes to a wire response with an optional correlation id', () => {
    const error = new ValidationError('Bad input', { field: 'amount' });
    expect(error.toResponse()).toEqual({
      code: ErrorCode.VALIDATION_FAILED,
      category: ErrorCategory.Validation,
      message: 'Bad input',
      details: { field: 'amount' },
    });
    expect(error.toResponse('corr_1').correlationId).toBe('corr_1');
  });

  it('recognizes domain errors via the guard', () => {
    expect(isDomainError(new NotFoundError())).toBe(true);
    expect(isDomainError(new Error('plain'))).toBe(false);
    expect(isDomainError(null)).toBe(false);
  });
});
