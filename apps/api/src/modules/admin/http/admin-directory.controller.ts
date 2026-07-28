import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import type {
  AdminCustomerDetailDto,
  AdminCustomerPageDto,
  AdminLedgerAccountDto,
  WalletTransactionsPageDto,
} from '@fides/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import { TransactionHistoryReader } from '../../ledger/application/transaction-history.reader';
import {
  AdminAuthGuard,
  AdminPermissionGuard,
  RequirePermission,
} from '../application/admin-auth.guard';
import { AdminReadService } from '../application/admin-read.service';
import { AdminPermission } from '../domain/permissions';
import {
  AdminCustomerQueryDto,
  AdminLedgerAccountParamsDto,
  AdminPaginationQueryDto,
  AdminUserIdParamsDto,
  AdminWalletIdParamsDto,
} from './dtos';
import { toCustomerDetailDto, toCustomerPageDto, toLedgerAccountDto } from './mappers';
import { toWalletTransactionsPageDto } from '../../accounts/http/mappers';

/**
 * The back-office read surface (ADR-0025): the customer directory, any wallet's
 * history, and the ledger view.
 *
 * Authorization here is by **capability, not ownership** — an admin has no
 * resources of their own — so every route declares a permission and the
 * permission guard resolves it against the role matrix. That is the whole
 * reason `assertResourceOwnership` stays customer-only.
 */
@Controller('admin')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class AdminDirectoryController {
  // Explicit tokens: esbuild-based test transforms emit no design:paramtypes.
  constructor(
    @Inject(AdminReadService) private readonly read: AdminReadService,
    @Inject(TransactionHistoryReader) private readonly history: TransactionHistoryReader,
  ) {}

  @Get('customers')
  @RequirePermission(AdminPermission.CustomersRead)
  async listCustomers(
    @Query(new ZodValidationPipe(AdminCustomerQueryDto)) query: AdminCustomerQueryDto,
  ): Promise<AdminCustomerPageDto> {
    const page = await this.read.listCustomers({
      limit: query.limit,
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
      ...(query.email !== undefined ? { email: query.email } : {}),
    });
    return toCustomerPageDto(page);
  }

  @Get('customers/:userId')
  @RequirePermission(AdminPermission.CustomersRead)
  async getCustomer(
    @Param(new ZodValidationPipe(AdminUserIdParamsDto)) params: AdminUserIdParamsDto,
  ): Promise<AdminCustomerDetailDto> {
    return toCustomerDetailDto(await this.read.getCustomer(params.userId));
  }

  @Get('wallets/:walletId/transactions')
  @RequirePermission(AdminPermission.WalletsRead)
  async walletTransactions(
    @Param(new ZodValidationPipe(AdminWalletIdParamsDto)) params: AdminWalletIdParamsDto,
    @Query(new ZodValidationPipe(AdminPaginationQueryDto)) query: AdminPaginationQueryDto,
  ): Promise<WalletTransactionsPageDto> {
    const ledgerAccountId = await this.read.resolveWalletLedgerAccount(params.walletId);
    const page = await this.history.listByAccount(ledgerAccountId, {
      limit: query.limit,
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    });
    return toWalletTransactionsPageDto(page);
  }

  @Get('ledger/accounts/:ledgerAccountId')
  @RequirePermission(AdminPermission.LedgerRead)
  async ledgerAccount(
    @Param(new ZodValidationPipe(AdminLedgerAccountParamsDto)) params: AdminLedgerAccountParamsDto,
  ): Promise<AdminLedgerAccountDto> {
    return toLedgerAccountDto(await this.read.getLedgerAccount(params.ledgerAccountId));
  }
}
