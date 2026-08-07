import { Body, Controller, Get, Headers, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type {
  AdminLoginResponseDto,
  AdminMfaEnrolResponseDto,
  AdminProfileDto,
  AdminSessionResponseDto,
} from '@fides/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import { AdminAuthGuard } from '../application/admin-auth.guard';
import { AdminIdentityService } from '../application/admin-identity.service';
import { AdminSessionService, type AdminPrincipal } from '../application/admin-session.service';
import { CurrentAdmin } from './current-admin.decorator';
import { AdminLoginRequestDto, AdminMfaEnrolRequestDto, AdminMfaVerifyRequestDto } from './dtos';
import { toAdminProfileDto, toAdminSessionDto } from './mappers';

/**
 * Back-office authentication (ADR-0025). The two factors are separate routes on
 * purpose: `login` proves the password and yields only a single-use challenge,
 * and `mfa/verify` proves possession and is the only place a session is issued.
 *
 * Both unauthenticated steps are throttled tightly — that throttle, not the
 * challenge itself, is what bounds guessing a six-digit code inside its window.
 */
@Controller('admin/auth')
@UseGuards(ThrottlerGuard)
export class AdminAuthController {
  // Explicit tokens: esbuild-based test transforms emit no design:paramtypes.
  constructor(
    @Inject(AdminIdentityService) private readonly identity: AdminIdentityService,
    @Inject(AdminSessionService) private readonly sessions: AdminSessionService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body(new ZodValidationPipe(AdminLoginRequestDto)) body: AdminLoginRequestDto,
  ): Promise<AdminLoginResponseDto> {
    const challenge = await this.identity.login(body.email, body.password, correlationId);
    return {
      challengeToken: challenge.challengeToken,
      mfaEnrolled: challenge.mfaEnrolled,
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  @Post('mfa/enrol')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async enrol(
    @Body(new ZodValidationPipe(AdminMfaEnrolRequestDto)) body: AdminMfaEnrolRequestDto,
  ): Promise<AdminMfaEnrolResponseDto> {
    return this.identity.beginMfaEnrolment(body.challengeToken);
  }

  @Post('mfa/verify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verify(
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body(new ZodValidationPipe(AdminMfaVerifyRequestDto)) body: AdminMfaVerifyRequestDto,
  ): Promise<AdminSessionResponseDto> {
    const session = await this.identity.verifyMfa(body.challengeToken, body.code, correlationId);
    const admin = await this.identity.getAdmin(session.adminId);
    return toAdminSessionDto(session, admin.role);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AdminAuthGuard)
  async logout(
    @CurrentAdmin() admin: AdminPrincipal,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ): Promise<void> {
    await this.sessions.revokeSession(admin.sessionId, {
      adminId: admin.adminId,
      reason: 'logout',
      ...(correlationId !== undefined ? { correlationId } : {}),
    });
  }
}

/**
 * The authenticated admin's own profile. Separate controller so the route sits
 * at `/v1/admin/me` rather than under `/v1/admin/auth`.
 */
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminProfileController {
  constructor(@Inject(AdminIdentityService) private readonly identity: AdminIdentityService) {}

  @Get('me')
  async me(@CurrentAdmin() admin: AdminPrincipal): Promise<AdminProfileDto> {
    return toAdminProfileDto(await this.identity.getAdmin(admin.adminId));
  }
}
