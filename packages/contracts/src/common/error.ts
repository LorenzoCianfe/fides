import { ErrorCategory } from '@fides/domain';
import { z } from '../zod';

const categories = Object.values(ErrorCategory) as [string, ...string[]];

export const ErrorCategorySchema = z.enum(categories).openapi('ErrorCategory');

/**
 * Canonical error envelope. Mirrors the domain `ErrorResponseBody` so every
 * tier speaks the same error language.
 */
export const ErrorResponseSchema = z
  .object({
    code: z.string().openapi({ description: 'Stable error code', example: 'VALIDATION_FAILED' }),
    category: ErrorCategorySchema,
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    correlationId: z.string().optional(),
  })
  .openapi('ErrorResponse');

export type ErrorResponseDto = z.infer<typeof ErrorResponseSchema>;
