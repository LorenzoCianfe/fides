import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { SessionListResponseDto } from '@fides/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import { SessionAuthGuard } from '../application/auth.guard';
import { SessionService, type Principal } from '../application/session.service';
import { CurrentPrincipal } from './current-principal.decorator';
import { SessionIdParamsDto } from './dtos';

/** Session management for the authenticated caller (ADR-0020). */
@Controller('auth')
@UseGuards(SessionAuthGuard)
export class SessionsController {
  // Explicit token: esbuild-based test transforms emit no design:paramtypes.
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentPrincipal() principal: Principal): Promise<void> {
    await this.sessions.revokeSession(principal.sessionId, {
      userId: principal.userId,
      reason: 'logout',
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
    @Param(new ZodValidationPipe(SessionIdParamsDto)) params: SessionIdParamsDto,
  ): Promise<void> {
    await this.sessions.revokeSession(params.sessionId, {
      userId: principal.userId,
      reason: 'user_revoked',
    });
  }
}
