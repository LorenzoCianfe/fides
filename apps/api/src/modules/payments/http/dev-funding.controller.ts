import { Body, Controller, Headers, Inject, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { DevFundingResponseDto } from '@fides/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import { SessionAuthGuard } from '../../identity/application/auth.guard';
import type { Principal } from '../../identity/application/session.service';
import { CurrentPrincipal } from '../../identity/http/current-principal.decorator';
import { FundingService } from '../application/funding.service';
import { DevFundingRequestDto } from './dtos';
import { requireIdempotencyKey } from './idempotency-key';

/**
 * Dev funding faucet (Slice 5, ADR-0023): credits the caller's own wallet from
 * settlement. Session-guarded, throttled, idempotent; kill-switched and capped
 * in the service. A development affordance until admin RBAC (Slice 7) — when
 * disabled the service answers 404 so the route reads as absent.
 */
@Controller('dev/funding')
@UseGuards(ThrottlerGuard, SessionAuthGuard)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class DevFundingController {
  // Explicit token: esbuild-based test transforms emit no design:paramtypes.
  constructor(@Inject(FundingService) private readonly funding: FundingService) {}

  @Post()
  async create(
    @CurrentPrincipal() principal: Principal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(DevFundingRequestDto)) body: DevFundingRequestDto,
  ): Promise<DevFundingResponseDto> {
    const result = await this.funding.fund({
      principal,
      amount: body.amount,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
    return {
      fundingId: result.fundingId,
      amount: result.amount.toJSON(),
      balance: result.balance.toJSON(),
      occurredAt: result.occurredAt,
    };
  }
}
