import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  AdminFundingApprovalResponseDto,
  AdminTotpResetApprovalResponseDto,
  PendingActionDto,
  PendingActionPageDto,
} from '@fides/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import { requireIdempotencyKey } from '../../payments/http/idempotency-key';
import {
  AdminAuthGuard,
  AdminPermissionGuard,
  RequirePermission,
} from '../application/admin-auth.guard';
import type { AdminPrincipal } from '../application/admin-session.service';
import {
  ADMIN_FUNDING_ACTION,
  ADMIN_TOTP_RESET_ACTION,
  PendingAdminActionService,
} from '../application/pending-admin-action.service';
import { AdminPermission } from '../domain/permissions';
import { CurrentAdmin } from './current-admin.decorator';
import {
  AdminFundingRequestDto,
  AdminTotpResetRequestDto,
  PendingActionDecisionDto,
  PendingActionIdParamsDto,
  PendingActionQueryDto,
} from './dtos';
import { toPendingActionDto, toPendingActionPageDto } from './mappers';

/**
 * The four-eyes surface (ADR-0011, ADR-0025, ADR-0030) — two high-risk admin
 * actions, and the proof that the maker-checker machinery works on real money
 * and on real credentials rather than on a hypothetical payload.
 *
 * The maker and checker routes require *different* permissions, and no role
 * holds both halves of either pair, so segregation of duties is enforced before
 * a request even reaches the service.
 *
 * Reads are unified over the queue; **decisions are type-scoped**. The
 * permission a decision needs depends on the row's type, which a route-level
 * annotation cannot know, so the only generic alternative would move the
 * decisive authorization check off the route and into the service — out of the
 * diff that ought to show it. The service asserts the type again under the row
 * lock, so pointing one type's decision route at the other's id fails there too.
 */
@Controller('admin')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class AdminFourEyesController {
  // Explicit token: esbuild-based test transforms emit no design:paramtypes.
  constructor(
    @Inject(PendingAdminActionService) private readonly actions: PendingAdminActionService,
  ) {}

  @Post('funding-requests')
  @RequirePermission(AdminPermission.AdminFundingRequest)
  async requestFunding(
    @CurrentAdmin() admin: AdminPrincipal,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body(new ZodValidationPipe(AdminFundingRequestDto)) body: AdminFundingRequestDto,
  ): Promise<PendingActionDto> {
    const action = await this.actions.requestFunding(
      admin,
      { userId: body.userId, amount: body.amount, reason: body.reason },
      correlationId,
    );
    return toPendingActionDto(action);
  }

  @Post('totp-resets')
  @RequirePermission(AdminPermission.AdminTotpResetRequest)
  async requestTotpReset(
    @CurrentAdmin() admin: AdminPrincipal,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body(new ZodValidationPipe(AdminTotpResetRequestDto)) body: AdminTotpResetRequestDto,
  ): Promise<PendingActionDto> {
    const action = await this.actions.requestTotpReset(
      admin,
      { targetAdminId: body.adminId, reason: body.reason },
      correlationId,
    );
    return toPendingActionDto(action);
  }

  @Get('pending-actions')
  @RequirePermission(AdminPermission.PendingActionsRead)
  async list(
    @Query(new ZodValidationPipe(PendingActionQueryDto)) query: PendingActionQueryDto,
  ): Promise<PendingActionPageDto> {
    const page = await this.actions.list({
      limit: query.limit,
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
    });
    return toPendingActionPageDto(page);
  }

  @Get('pending-actions/:actionId')
  @RequirePermission(AdminPermission.PendingActionsRead)
  async get(
    @Param(new ZodValidationPipe(PendingActionIdParamsDto)) params: PendingActionIdParamsDto,
  ): Promise<PendingActionDto> {
    return toPendingActionDto(await this.actions.get(params.actionId));
  }

  @Post('funding-requests/:actionId/approve')
  @RequirePermission(AdminPermission.AdminFundingApprove)
  async approveFunding(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param(new ZodValidationPipe(PendingActionIdParamsDto)) params: PendingActionIdParamsDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body(new ZodValidationPipe(PendingActionDecisionDto)) body: PendingActionDecisionDto,
  ): Promise<AdminFundingApprovalResponseDto> {
    const result = await this.actions.approve(admin, params.actionId, {
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      ...(body.reason !== undefined ? { decisionReason: body.reason } : {}),
      ...(correlationId !== undefined ? { correlationId } : {}),
    });
    return { action: toPendingActionDto(result.action), fundingId: result.fundingId };
  }

  @Post('funding-requests/:actionId/reject')
  @HttpCode(200)
  @RequirePermission(AdminPermission.AdminFundingApprove)
  async rejectFunding(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param(new ZodValidationPipe(PendingActionIdParamsDto)) params: PendingActionIdParamsDto,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body(new ZodValidationPipe(PendingActionDecisionDto)) body: PendingActionDecisionDto,
  ): Promise<PendingActionDto> {
    const action = await this.actions.reject(admin, params.actionId, ADMIN_FUNDING_ACTION, {
      ...(body.reason !== undefined ? { decisionReason: body.reason } : {}),
      ...(correlationId !== undefined ? { correlationId } : {}),
    });
    return toPendingActionDto(action);
  }

  /**
   * No `Idempotency-Key` here, unlike the funding approval: there is no ledger
   * posting to replay, and clearing an already-cleared factor is not a second
   * effect. A retry after a lost response gets a 400 naming the current status.
   */
  @Post('totp-resets/:actionId/approve')
  @HttpCode(200)
  @RequirePermission(AdminPermission.AdminTotpResetApprove)
  async approveTotpReset(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param(new ZodValidationPipe(PendingActionIdParamsDto)) params: PendingActionIdParamsDto,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body(new ZodValidationPipe(PendingActionDecisionDto)) body: PendingActionDecisionDto,
  ): Promise<AdminTotpResetApprovalResponseDto> {
    const result = await this.actions.approveTotpReset(admin, params.actionId, {
      ...(body.reason !== undefined ? { decisionReason: body.reason } : {}),
      ...(correlationId !== undefined ? { correlationId } : {}),
    });
    return {
      action: toPendingActionDto(result.action),
      revokedSessions: result.revokedSessions,
    };
  }

  @Post('totp-resets/:actionId/reject')
  @HttpCode(200)
  @RequirePermission(AdminPermission.AdminTotpResetApprove)
  async rejectTotpReset(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param(new ZodValidationPipe(PendingActionIdParamsDto)) params: PendingActionIdParamsDto,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body(new ZodValidationPipe(PendingActionDecisionDto)) body: PendingActionDecisionDto,
  ): Promise<PendingActionDto> {
    const action = await this.actions.reject(admin, params.actionId, ADMIN_TOTP_RESET_ACTION, {
      ...(body.reason !== undefined ? { decisionReason: body.reason } : {}),
      ...(correlationId !== undefined ? { correlationId } : {}),
    });
    return toPendingActionDto(action);
  }
}
