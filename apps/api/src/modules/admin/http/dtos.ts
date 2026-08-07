import {
  AdminCreateRequestSchema,
  AdminCustomerQuerySchema,
  AdminIdParamsSchema,
  AdminStatusRequestSchema,
  AdminFundingRequestSchema,
  AdminLedgerAccountParamsSchema,
  AdminLoginRequestSchema,
  AdminMfaEnrolRequestSchema,
  AdminMfaVerifyRequestSchema,
  AdminPasswordChangeRequestSchema,
  AdminTotpResetRequestSchema,
  AdminUserIdParamsSchema,
  AuditAnchorVerifyRequestSchema,
  AuditQuerySchema,
  PaginationQuerySchema,
  PendingActionDecisionSchema,
  PendingActionIdParamsSchema,
  PendingActionQuerySchema,
  WalletIdParamsSchema,
} from '@fides/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * Request DTO classes binding the shared Zod contracts to the ZodValidationPipe.
 * Contracts stay framework-free; only this file knows Nest.
 */
export class AdminLoginRequestDto extends createZodDto(AdminLoginRequestSchema) {}

export class AdminMfaEnrolRequestDto extends createZodDto(AdminMfaEnrolRequestSchema) {}

export class AdminMfaVerifyRequestDto extends createZodDto(AdminMfaVerifyRequestSchema) {}

export class AdminPasswordChangeRequestDto extends createZodDto(AdminPasswordChangeRequestSchema) {}

export class AdminTotpResetRequestDto extends createZodDto(AdminTotpResetRequestSchema) {}

export class AdminCreateRequestDto extends createZodDto(AdminCreateRequestSchema) {}

export class AdminIdParamsDto extends createZodDto(AdminIdParamsSchema) {}

export class AdminStatusRequestDto extends createZodDto(AdminStatusRequestSchema) {}

export class AdminCustomerQueryDto extends createZodDto(AdminCustomerQuerySchema) {}

export class AdminUserIdParamsDto extends createZodDto(AdminUserIdParamsSchema) {}

export class AdminWalletIdParamsDto extends createZodDto(WalletIdParamsSchema) {}

export class AdminPaginationQueryDto extends createZodDto(PaginationQuerySchema) {}

export class AdminLedgerAccountParamsDto extends createZodDto(AdminLedgerAccountParamsSchema) {}

export class AdminAuditQueryDto extends createZodDto(AuditQuerySchema) {}

export class AuditAnchorVerifyRequestDto extends createZodDto(AuditAnchorVerifyRequestSchema) {}

export class AdminFundingRequestDto extends createZodDto(AdminFundingRequestSchema) {}

export class PendingActionQueryDto extends createZodDto(PendingActionQuerySchema) {}

export class PendingActionIdParamsDto extends createZodDto(PendingActionIdParamsSchema) {}

export class PendingActionDecisionDto extends createZodDto(PendingActionDecisionSchema) {}
