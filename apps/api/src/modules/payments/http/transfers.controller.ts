import { Body, Controller, Headers, Inject, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { TransferResponseDto } from '@fides/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import { SessionAuthGuard } from '../../identity/application/auth.guard';
import type { Principal } from '../../identity/application/session.service';
import { CurrentPrincipal } from '../../identity/http/current-principal.decorator';
import { TransferService } from '../application/transfer.service';
import { TransferRequestDto } from './dtos';
import { requireIdempotencyKey } from './idempotency-key';

/**
 * Internal instant P2P transfer surface (Slice 5, ADR-0023). Session-guarded,
 * throttled, idempotent on the Idempotency-Key header, and SCA-gated: the
 * request carries the single-use grant minted by /v1/auth/sca/verify.
 */
@Controller('transfers')
@UseGuards(ThrottlerGuard, SessionAuthGuard)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class TransfersController {
  // Explicit token: esbuild-based test transforms emit no design:paramtypes.
  constructor(@Inject(TransferService) private readonly transfers: TransferService) {}

  @Post()
  async create(
    @CurrentPrincipal() principal: Principal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(TransferRequestDto)) body: TransferRequestDto,
  ): Promise<TransferResponseDto> {
    const result = await this.transfers.transfer({
      principal,
      recipient: body.recipient,
      amount: body.amount,
      grant: body.grant,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
    return {
      transferId: result.transferId,
      amount: result.amount.toJSON(),
      senderBalance: result.senderBalance.toJSON(),
      occurredAt: result.occurredAt,
    };
  }
}
