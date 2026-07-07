import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { ScaGrantResponseDto, WebAuthnRequestOptionsDto } from '@fides/contracts';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { ZodValidationPipe } from 'nestjs-zod';
import { SessionAuthGuard } from '../application/auth.guard';
import type { Principal } from '../application/session.service';
import { WebAuthnService } from '../application/webauthn.service';
import { CurrentPrincipal } from './current-principal.decorator';
import { FinishScaDto, StartScaDto } from './dtos';

/**
 * Step-up SCA under PSD2 dynamic linking (ADR-0021): a fresh assertion over an
 * action-bound challenge mints a single-use grant the guarded action consumes.
 */
@Controller('auth/sca')
@UseGuards(ThrottlerGuard, SessionAuthGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class ScaController {
  // Explicit token: esbuild-based test transforms emit no design:paramtypes.
  constructor(@Inject(WebAuthnService) private readonly webauthn: WebAuthnService) {}

  @Post('options')
  @HttpCode(HttpStatus.OK)
  start(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(StartScaDto)) body: StartScaDto,
  ): Promise<WebAuthnRequestOptionsDto> {
    return this.webauthn.startStepUp({ userId: principal.userId, action: body.action });
  }

  @Post('verify')
  async finish(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(FinishScaDto)) body: FinishScaDto,
  ): Promise<ScaGrantResponseDto> {
    const grant = await this.webauthn.finishStepUp({
      userId: principal.userId,
      sessionId: principal.sessionId,
      action: body.action,
      response: body.response as AuthenticationResponseJSON,
    });
    return {
      grant: grant.grant,
      actionHash: grant.actionHash,
      expiresAt: grant.expiresAt.toISOString(),
    };
  }
}
