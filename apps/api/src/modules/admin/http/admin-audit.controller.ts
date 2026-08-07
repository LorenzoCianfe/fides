import { Body, Controller, Get, HttpCode, Inject, Post, Query, UseGuards } from '@nestjs/common';
import type {
  AuditAnchorVerificationDto,
  AuditPageDto,
  AuditTailVerificationDto,
  AuditVerificationDto,
} from '@fides/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import type { AuditTailVerification } from '../../audit/application/audit-anchor.service';
import {
  AdminAuthGuard,
  AdminPermissionGuard,
  RequirePermission,
} from '../application/admin-auth.guard';
import { AdminReadService } from '../application/admin-read.service';
import { AdminPermission } from '../domain/permissions';
import { AdminAuditQueryDto, AuditAnchorVerifyRequestDto } from './dtos';
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
      tail: toTailDto(result.tail),
      verifiedAt: result.verifiedAt.toISOString(),
    };
  }

  /**
   * Verify the trail against an anchor the caller holds from the log archive
   * (ADR-0031).
   *
   * A POST because the anchor is a payload rather than an identifier, and it
   * must not end up in a URL, an access log, or a browser history — the same
   * reasoning that keeps the enrolment token out of the web client's query
   * string. It changes nothing on the server.
   */
  @Post('verify-anchor')
  @HttpCode(200)
  @RequirePermission(AdminPermission.AuditRead)
  async verifyAnchor(
    @Body(new ZodValidationPipe(AuditAnchorVerifyRequestDto)) body: AuditAnchorVerifyRequestDto,
  ): Promise<AuditAnchorVerificationDto> {
    const result = await this.read.verifyAuditAnchor(body.payload, body.signature);
    return {
      ...toTailDto(result),
      signatureValid: result.signatureValid,
      verifiedAt: result.verifiedAt.toISOString(),
    };
  }
}

function toTailDto(tail: AuditTailVerification): AuditTailVerificationDto {
  return {
    status: tail.status,
    headSeq: tail.headSeq,
    anchoredSeq: tail.anchoredSeq,
    anchoredAt: tail.anchoredAt?.toISOString() ?? null,
    detail: tail.detail,
  };
}
