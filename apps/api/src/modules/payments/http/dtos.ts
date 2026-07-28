import { TransferRequestSchema } from '@fides/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * Request DTO classes binding the shared Zod contracts to the ZodValidationPipe.
 * Contracts stay framework-free; only this file knows Nest.
 */
export class TransferRequestDto extends createZodDto(TransferRequestSchema) {}
