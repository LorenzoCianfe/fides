import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import type { AccountDto, AccountListResponseDto } from '@fides/contracts';
import { ZodValidationPipe } from 'nestjs-zod';
import { SessionAuthGuard } from '../../identity/application/auth.guard';
import type { Principal } from '../../identity/application/session.service';
import { CurrentPrincipal } from '../../identity/http/current-principal.decorator';
import { AccountService } from '../application/account.service';
import { AccountIdParamsDto } from './dtos';
import { toAccountDto } from './mappers';

/**
 * Customer account read surface (Slice 4). Every route is session-guarded and
 * ownership-scoped: the list is bound to the authenticated principal, and the
 * single read asserts ownership server-side.
 */
@Controller('accounts')
@UseGuards(SessionAuthGuard)
export class AccountsController {
  // Explicit token: esbuild-based test transforms emit no design:paramtypes.
  constructor(@Inject(AccountService) private readonly accounts: AccountService) {}

  @Get()
  async list(@CurrentPrincipal() principal: Principal): Promise<AccountListResponseDto> {
    const accounts = await this.accounts.listAccounts(principal.userId);
    return { accounts: accounts.map(toAccountDto) };
  }

  @Get(':accountId')
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param(new ZodValidationPipe(AccountIdParamsDto)) params: AccountIdParamsDto,
  ): Promise<AccountDto> {
    const account = await this.accounts.getAccount(principal, params.accountId);
    return toAccountDto(account);
  }
}
