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
import { PendingAdminActionService } from '../application/pending-admin-action.service';
import { AdminPermission } from '../domain/permissions';
import { CurrentAdmin } from './current-admin.decorator';
import {
  AdminFundingRequestDto,
  PendingActionDecisionDto,
  PendingActionIdParamsDto,
  PendingActionQueryDto,
} from './dtos';
import { toPendingActionDto, toPendingActionPageDto } from './mappers';

/**
 * Four-eyes admin funding (ADR-0011, ADR-0025) — the one high-risk admin action
 * that exists in Phase 1, and the proof that the maker-checker machinery works
 * on real money rather than on a hypothetical payload.
 *
 * The maker and checker routes require *different* permissions, and no role
 * holds both, so segregation of duties is enforced before a request even
 * reaches the service. The approval is money-moving and therefore carries an
 * `Idempotency-Key`, like every other money route.
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

  @Post('pending-actions/:actionId/approve')
  @RequirePermission(AdminPermission.AdminFundingApprove)
  async approve(
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

  @Post('pending-actions/:actionId/reject')
  @HttpCode(200)
  @RequirePermission(AdminPermission.AdminFundingApprove)
  async reject(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param(new ZodValidationPipe(PendingActionIdParamsDto)) params: PendingActionIdParamsDto,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body(new ZodValidationPipe(PendingActionDecisionDto)) body: PendingActionDecisionDto,
  ): Promise<PendingActionDto> {
    const action = await this.actions.reject(admin, params.actionId, {
      ...(body.reason !== undefined ? { decisionReason: body.reason } : {}),
      ...(correlationId !== undefined ? { correlationId } : {}),
    });
    return toPendingActionDto(action);
  }
}
