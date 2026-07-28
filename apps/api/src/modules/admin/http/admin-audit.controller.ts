import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import type { AuditPageDto, AuditVerificationDto } from '@fides/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import {
  AdminAuthGuard,
  AdminPermissionGuard,
  RequirePermission,
} from '../application/admin-auth.guard';
import { AdminReadService } from '../application/admin-read.service';
import { AdminPermission } from '../domain/permissions';
import { AdminAuditQueryDto } from './dtos';
import { toAuditPageDto } from './mappers';

/**
 * The audit read and verification surface (ADR-0024, ADR-0025).
 *
 * Slice 6 built the tamper-evident trail but deliberately shipped no way to
 * read it, on the grounds that reading it is an administrative capability. This
 * is that capability: gated on `audit.read`, which the auditor, fraud analyst,
 * compliance officer, and super-admin roles hold and the support agent does not.
 *
 * `verify` walks the whole chain rather than a page of it — a range-scoped
 * answer could not establish that the sequence is gap-free.
 */
@Controller('admin/audit')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class AdminAuditController {
  // Explicit token: esbuild-based test transforms emit no design:paramtypes.
  constructor(@Inject(AdminReadService) private readonly read: AdminReadService) {}

  @Get()
  @RequirePermission(AdminPermission.AuditRead)
  async list(
    @Query(new ZodValidationPipe(AdminAuditQueryDto)) query: AdminAuditQueryDto,
  ): Promise<AuditPageDto> {
    const page = await this.read.listAuditRecords({
      limit: query.limit,
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
      ...(query.action !== undefined ? { action: query.action } : {}),
      ...(query.actorId !== undefined ? { actorId: query.actorId } : {}),
      ...(query.actorType !== undefined ? { actorType: query.actorType } : {}),
    });
    return toAuditPageDto(page);
  }

  @Get('verify')
  @RequirePermission(AdminPermission.AuditRead)
  async verify(): Promise<AuditVerificationDto> {
    const result = await this.read.verifyAudit();
    return {
      ok: result.ok,
      count: result.count,
      brokenAtSeq: result.brokenAtSeq,
      verifiedAt: result.verifiedAt.toISOString(),
    };
  }
}
