import { z } from '../zod';
import { EmailSchema } from './primitives';

/** Natural-person onboarding payload (Phase 1: EU residents). */
export const RegisterRequestSchema = z
  .object({
    email: EmailSchema,
    givenName: z.string().trim().min(1).max(100),
    familyName: z.string().trim().min(1).max(100),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO 8601 date (YYYY-MM-DD)')
      .openapi({ example: '1990-05-01' }),
    phone: z.string().trim().min(3).max(32).optional(),
    addressLine1: z.string().trim().min(1).max(200),
    addressLine2: z.string().trim().min(1).max(200).optional(),
    city: z.string().trim().min(1).max(100),
    postalCode: z.string().trim().min(1).max(20),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'Expected an ISO 3166-1 alpha-2 country code')
      .openapi({ example: 'FR' }),
  })
  .openapi('RegisterRequest');

export type RegisterRequestDto = z.infer<typeof RegisterRequestSchema>;

export const RegisterResponseSchema = z
  .object({
    userId: z.string().uuid(),
    status: z.string().openapi({ example: 'onboarding' }),
    kycStatus: z.string().openapi({ example: 'approved' }),
  })
  .openapi('RegisterResponse');

export type RegisterResponseDto = z.infer<typeof RegisterResponseSchema>;

export const VerifyEmailRequestSchema = z
  .object({
    email: EmailSchema,
    code: z.string().regex(/^\d{6}$/, 'Expected the 6-digit verification code'),
  })
  .openapi('VerifyEmailRequest');

export type VerifyEmailRequestDto = z.infer<typeof VerifyEmailRequestSchema>;

export const VerifyEmailResponseSchema = z
  .object({
    userId: z.string().uuid(),
    enrolmentToken: z
      .string()
      .openapi({ description: 'One-time token (fet_…) authorizing the first passkey' }),
  })
  .openapi('VerifyEmailResponse');

export type VerifyEmailResponseDto = z.infer<typeof VerifyEmailResponseSchema>;

/** Always answered 202 regardless of outcome (anti-enumeration, ADR-0021). */
export const ResendVerificationRequestSchema = z
  .object({ email: EmailSchema })
  .openapi('ResendVerificationRequest');

export type ResendVerificationRequestDto = z.infer<typeof ResendVerificationRequestSchema>;
