import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AdminListResponseDto, AdminSummaryDto } from '@fides/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import {
  AdminAuthGuard,
  AdminPermissionGuard,
  RequirePermission,
} from '../application/admin-auth.guard';
import { AdminIdentityService, type AdminSummary } from '../application/admin-identity.service';
import type { AdminPrincipal } from '../application/admin-session.service';
import { AdminPermission } from '../domain/permissions';
import { CurrentAdmin } from './current-admin.decorator';
import { AdminCreateRequestDto, AdminIdParamsDto, AdminStatusRequestDto } from './dtos';

function toAdminSummaryDto(admin: AdminSummary): AdminSummaryDto {
  return {
    id: admin.id,
    email: admin.email,
    role: admin.role,
    status: admin.status,
    mfaEnrolled: admin.mfaEnrolled,
    lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
    createdAt: admin.createdAt.toISOString(),
  };
}

/**
 * Back-office staffing (ADR-0025), behind `admins.manage` — super_admin only.
 *
 * This exists because four-eyes is not a real control if only one operator can
 * ever exist: the checker is seeded from configuration, and this is how the
 * maker comes to be. Every response is secret-free; a new admin holds a
 * password and no second factor until they enrol at first login.
 */
@Controller('admin/admins')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class AdminStaffController {
  // Explicit token: esbuild-based test transforms emit no design:paramtypes.
  constructor(@Inject(AdminIdentityService) private readonly identity: AdminIdentityService) {}

  @Post()
  @RequirePermission(AdminPermission.AdminsManage)
  async create(
    @CurrentAdmin() admin: AdminPrincipal,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body(new ZodValidationPipe(AdminCreateRequestDto)) body: AdminCreateRequestDto,
  ): Promise<AdminSummaryDto> {
    const created = await this.identity.createAdmin(
      admin,
      { email: body.email, role: body.role, password: body.password },
      correlationId,
    );
    return toAdminSummaryDto(created);
  }

  @Get()
  @RequirePermission(AdminPermission.AdminsManage)
  async list(): Promise<AdminListResponseDto> {
    const admins = await this.identity.listAdmins();
    return { admins: admins.map(toAdminSummaryDto) };
  }

  @Post(':adminId/status')
  @HttpCode(200)
  @RequirePermission(AdminPermission.AdminsManage)
  async setStatus(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param(new ZodValidationPipe(AdminIdParamsDto)) params: AdminIdParamsDto,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body(new ZodValidationPipe(AdminStatusRequestDto)) body: AdminStatusRequestDto,
  ): Promise<AdminSummaryDto> {
    const updated = await this.identity.setAdminStatus(
      admin,
      params.adminId,
      body.status,
      correlationId,
    );
    return toAdminSummaryDto(updated);
  }
}
