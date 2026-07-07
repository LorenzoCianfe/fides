import {
  FinishAuthenticationRequestSchema,
  FinishPasskeyRegistrationRequestSchema,
  FinishScaRequestSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
  ResendVerificationRequestSchema,
  StartAuthenticationRequestSchema,
  StartPasskeyRegistrationRequestSchema,
  StartScaRequestSchema,
  VerifyEmailRequestSchema,
  z,
} from '@fides/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * Request DTO classes binding the shared Zod contracts to the global
 * ZodValidationPipe. Contracts stay framework-free; only this file knows Nest.
 */

export class RegisterDto extends createZodDto(RegisterRequestSchema) {}
export class VerifyEmailDto extends createZodDto(VerifyEmailRequestSchema) {}
export class ResendVerificationDto extends createZodDto(ResendVerificationRequestSchema) {}
export class StartPasskeyRegistrationDto extends createZodDto(
  StartPasskeyRegistrationRequestSchema,
) {}
export class FinishPasskeyRegistrationDto extends createZodDto(
  FinishPasskeyRegistrationRequestSchema,
) {}
export class StartAuthenticationDto extends createZodDto(StartAuthenticationRequestSchema) {}
export class FinishAuthenticationDto extends createZodDto(FinishAuthenticationRequestSchema) {}
export class RefreshDto extends createZodDto(RefreshRequestSchema) {}
export class StartScaDto extends createZodDto(StartScaRequestSchema) {}
export class FinishScaDto extends createZodDto(FinishScaRequestSchema) {}

export class SessionIdParamsDto extends createZodDto(z.object({ sessionId: z.string().uuid() })) {}
