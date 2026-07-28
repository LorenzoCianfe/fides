import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { ErrorResponseDto } from '@fides/contracts';
import {
  DomainError,
  ErrorCategory,
  InternalError,
  RateLimitError,
  ValidationError,
  isDomainError,
} from '@fides/domain';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

/** Concrete wrapper for framework HTTP exceptions mapped into the taxonomy. */
class GenericHttpError extends DomainError {
  constructor(status: number, message: string) {
    const category =
      status >= 500
        ? ErrorCategory.Internal
        : status === 404
          ? ErrorCategory.NotFound
          : status === 401
            ? ErrorCategory.Authentication
            : status === 403
              ? ErrorCategory.Authorization
              : ErrorCategory.Validation;
    super({ code: `HTTP_${status}`, category, httpStatus: status, message });
  }
}

/**
 * Catches every error and renders the canonical {@link ErrorResponseDto}.
 * No silent failures: 5xx faults are logged; nothing internal leaks to clients.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationHeader = request.headers['x-correlation-id'];
    const correlationId = Array.isArray(correlationHeader)
      ? correlationHeader[0]
      : correlationHeader;

    const error = this.toDomainError(exception);
    if (error.httpStatus >= 500) {
      this.logger.error(
        `${error.code}: ${error.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: ErrorResponseDto = error.toResponse(correlationId);
    response.status(error.httpStatus).json(body);
  }

  private toDomainError(exception: unknown): DomainError {
    if (isDomainError(exception)) return exception;
    if (exception instanceof ZodError) {
      return new ValidationError('Validation failed', { issues: exception.issues });
    }
    if (exception instanceof HttpException) {
      const zodError = extractZodError(exception);
      if (zodError) {
        return new ValidationError('Validation failed', { issues: zodError.issues });
      }
      if (exception.getStatus() === 429) return new RateLimitError();
      return new GenericHttpError(exception.getStatus(), exception.message);
    }
    return new InternalError('Unexpected error');
  }
}

/** Unwrap the ZodError carried by nestjs-zod's validation exception, if any. */
function extractZodError(exception: HttpException): ZodError | undefined {
  const candidate = (exception as { getZodError?: () => unknown }).getZodError?.();
  return candidate instanceof ZodError ? candidate : undefined;
}
