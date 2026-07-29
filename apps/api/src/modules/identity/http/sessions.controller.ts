import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { SessionListResponseDto } from '@fides/contracts';
import type { Response } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';
import { ENV, type Env } from '../../../config/env';
import { SessionAuthGuard } from '../application/auth.guard';
import { SessionService, type Principal } from '../application/session.service';
import { CurrentPrincipal } from './current-principal.decorator';
import { SessionIdParamsDto } from './dtos';
import { clearSessionCookies } from './token-transport';

/** Session management for the authenticated caller (ADR-0020). */
@Controller('auth')
@UseGuards(SessionAuthGuard)
export class SessionsController {
  // Explicit tokens: esbuild-based test transforms emit no design:paramtypes.
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentPrincipal() principal: Principal,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revokeSession(principal.sessionId, {
      userId: principal.userId,
      reason: 'logout',
      correlationId,
    });
    // Unconditional, and harmless in bearer mode: clearing a cookie the caller
    // never had is a no-op, and leaving a stale cookie behind after the session
    // is revoked would strand the browser on a dead credential.
    clearSessionCookies(response, {
      secure: this.env.COOKIE_SECURE,
      sameSite: this.env.COOKIE_SAMESITE,
    });
  }

  @Get('sessions')
  async list(@CurrentPrincipal() principal: Principal): Promise<SessionListResponseDto> {
    const rows = await this.sessions.listSessions(principal.userId);
    return {
      sessions: rows.map((row) => ({
        sessionId: row.sessionId,
        device: { id: row.deviceId, name: row.deviceName, platform: row.devicePlatform },
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt.toISOString(),
        current: row.sessionId === principal.sessionId,
      })),
    };
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentPrincipal() principal: Principal,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Param(new ZodValidationPipe(SessionIdParamsDto)) params: SessionIdParamsDto,
  ): Promise<void> {
    await this.sessions.revokeSession(params.sessionId, {
      userId: principal.userId,
      reason: 'user_revoked',
      correlationId,
    });
  }
}
