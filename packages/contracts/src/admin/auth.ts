import { z } from '../zod';

/** The ADR-0011 back-office roles; exactly one per admin in Phase 1. */
export const AdminRoleSchema = z
  .enum(['super_admin', 'compliance_officer', 'fraud_analyst', 'support_agent', 'auditor'])
  .openapi('AdminRole', { description: 'Back-office role', example: 'compliance_officer' });

export type AdminRoleDto = z.infer<typeof AdminRoleSchema>;

/**
 * First factor. A correct password yields only a short-lived challenge — never a
 * session — so no back-office session can ever rest on one factor (ADR-0025).
 */
export const AdminLoginRequestSchema = z
  .object({
    email: z.string().email().max(320),
    password: z.string().min(1).max(1024),
  })
  .openapi('AdminLoginRequest');

export type AdminLoginRequestDto = z.infer<typeof AdminLoginRequestSchema>;

export const AdminLoginResponseSchema = z
  .object({
    challengeToken: z
      .string()
      .openapi({ description: 'Single-use, short-lived token for the TOTP step (alc_…)' }),
    mfaEnrolled: z
      .boolean()
      .openapi({ description: 'False when the admin must enrol a second factor first' }),
    expiresAt: z.string().datetime(),
  })
  .openapi('AdminLoginResponse');

export type AdminLoginResponseDto = z.infer<typeof AdminLoginResponseSchema>;

export const AdminMfaEnrolRequestSchema = z
  .object({ challengeToken: z.string().min(1) })
  .openapi('AdminMfaEnrolRequest');

export type AdminMfaEnrolRequestDto = z.infer<typeof AdminMfaEnrolRequestSchema>;

/** The enrolment secret, returned exactly once and never retrievable again. */
export const AdminMfaEnrolResponseSchema = z
  .object({
    secret: z.string().openapi({ description: 'Base32 TOTP secret; shown once' }),
    otpauthUri: z.string().openapi({ description: 'otpauth:// URI for an authenticator app' }),
  })
  .openapi('AdminMfaEnrolResponse');

export type AdminMfaEnrolResponseDto = z.infer<typeof AdminMfaEnrolResponseSchema>;

export const AdminMfaVerifyRequestSchema = z
  .object({
    challengeToken: z.string().min(1),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .openapi({ description: 'Six-digit TOTP code', example: '123456' }),
  })
  .openapi('AdminMfaVerifyRequest');

export type AdminMfaVerifyRequestDto = z.infer<typeof AdminMfaVerifyRequestSchema>;

/**
 * An issued back-office session: a single opaque token with a sliding idle
 * deadline and a hard absolute cap. There is no refresh token (ADR-0025).
 */
export const AdminSessionResponseSchema = z
  .object({
    sessionId: z.string().uuid(),
    adminId: z.string().uuid(),
    role: AdminRoleSchema,
    token: z.string().openapi({ description: 'Opaque bearer token (ast_…)' }),
    idleExpiresAt: z.string().datetime(),
    absoluteExpiresAt: z.string().datetime(),
  })
  .openapi('AdminSession');

export type AdminSessionResponseDto = z.infer<typeof AdminSessionResponseSchema>;

/**
 * Staffing the back office (super_admin only). Four-eyes needs a second,
 * differently-roled operator to exist, so this is what makes the maker-checker
 * split operable rather than theoretical.
 */
export const AdminCreateRequestSchema = z
  .object({
    email: z.string().email().max(320),
    role: AdminRoleSchema,
    password: z
      .string()
      .min(12)
      .max(1024)
      .openapi({ description: 'Initial password; the admin enrols TOTP at first login' }),
  })
  .openapi('AdminCreateRequest');

export type AdminCreateRequestDto = z.infer<typeof AdminCreateRequestSchema>;

/** A back-office operator on the roster. Never carries password or TOTP material. */
export const AdminSummarySchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    role: AdminRoleSchema,
    status: z.enum(['active', 'disabled']),
    mfaEnrolled: z.boolean(),
    lastLoginAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('AdminSummary');

export type AdminSummaryDto = z.infer<typeof AdminSummarySchema>;

export const AdminListResponseSchema = z
  .object({ admins: z.array(AdminSummarySchema) })
  .openapi('AdminList');

export type AdminListResponseDto = z.infer<typeof AdminListResponseSchema>;

export const AdminStatusRequestSchema = z
  .object({ status: z.enum(['active', 'disabled']) })
  .openapi('AdminStatusRequest');

export type AdminStatusRequestDto = z.infer<typeof AdminStatusRequestSchema>;

export const AdminIdParamsSchema = z.object({ adminId: z.string().uuid() });

export type AdminIdParamsDto = z.infer<typeof AdminIdParamsSchema>;

/** The authenticated admin's own profile and effective capabilities. */
export const AdminProfileSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    role: AdminRoleSchema,
    permissions: z.array(z.string()).openapi({
      description: 'Effective permissions from the role matrix; the authorization source of truth',
    }),
    mfaEnrolled: z.boolean(),
    lastLoginAt: z.string().datetime().nullable(),
  })
  .openapi('AdminProfile');

export type AdminProfileDto = z.infer<typeof AdminProfileSchema>;
