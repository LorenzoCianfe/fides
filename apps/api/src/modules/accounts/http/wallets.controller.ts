import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import type { WalletTransactionsPageDto } from '@fides/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import { SessionAuthGuard } from '../../identity/application/auth.guard';
import type { Principal } from '../../identity/application/session.service';
import { CurrentPrincipal } from '../../identity/http/current-principal.decorator';
import { TransactionHistoryReader } from '../../ledger/application/transaction-history.reader';
import { WalletResolver } from '../application/wallet-resolver';
import { PaginationQueryDto, WalletIdParamsDto } from './dtos';
import { toWalletTransactionsPageDto } from './mappers';

/**
 * Customer wallet read surface (Slice 5). Exposes a wallet's transaction history
 * from the ledger projection, ownership-scoped: the wallet is resolved to its
 * owner server-side and ownership asserted before the history is read.
 */
@Controller('wallets')
@UseGuards(SessionAuthGuard)
export class WalletsController {
  // Explicit tokens: esbuild-based test transforms emit no design:paramtypes.
  constructor(
    @Inject(WalletResolver) private readonly wallets: WalletResolver,
    @Inject(TransactionHistoryReader) private readonly history: TransactionHistoryReader,
  ) {}

  @Get(':walletId/transactions')
  async transactions(
    @CurrentPrincipal() principal: Principal,
    @Param(new ZodValidationPipe(WalletIdParamsDto)) params: WalletIdParamsDto,
    @Query(new ZodValidationPipe(PaginationQueryDto)) query: PaginationQueryDto,
  ): Promise<WalletTransactionsPageDto> {
    const wallet = await this.wallets.resolveOwnedWallet(principal, params.walletId);
    const page = await this.history.listByAccount(wallet.ledgerAccountId, {
      limit: query.limit,
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    });
    return toWalletTransactionsPageDto(page);
  }
}
