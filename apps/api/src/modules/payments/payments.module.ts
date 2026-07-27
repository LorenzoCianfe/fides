import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { EventClock, IdGenerator } from '@fides/domain';
import { ENV, type Env } from '../../config/env';
import { CLOCK, ID_GENERATOR } from '../../shared/tokens';
import { AccountsModule } from '../accounts/accounts.module';
import { WalletResolver } from '../accounts/application/wallet-resolver';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/application/audit.service';
import { IdentityModule } from '../identity/identity.module';
import { PostingService } from '../ledger/application/posting.service';
import { LedgerStore } from '../ledger/infra/ledger.repository';
import { LedgerModule } from '../ledger/ledger.module';
import { FundingService } from './application/funding.service';
import { TransferService } from './application/transfer.service';
import { DevFundingController } from './http/dev-funding.controller';
import { TransfersController } from './http/transfers.controller';

/**
 * Payments module (Slice 5, ADR-0023): the SCA-gated internal P2P transfer and
 * the dev funding faucet. Both post through the ledger's PostingService; wallet
 * resolution comes from AccountsModule and the session guard from IdentityModule.
 * The throttler is module-scoped with the same env kill-switch as the auth surface.
 */
@Module({
  imports: [
    LedgerModule,
    AccountsModule,
    AuditModule,
    IdentityModule,
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 20 }],
        skipIf: (): boolean => !env.THROTTLE_ENABLED,
      }),
    }),
  ],
  controllers: [TransfersController, DevFundingController],
  providers: [
    {
      provide: TransferService,
      useFactory: (
        posting: PostingService,
        wallets: WalletResolver,
        ids: IdGenerator,
        clock: EventClock,
        audit: AuditService,
      ): TransferService => new TransferService(posting, wallets, ids, clock, audit),
      inject: [PostingService, WalletResolver, ID_GENERATOR, CLOCK, AuditService],
    },
    {
      provide: FundingService,
      useFactory: (
        ledger: LedgerStore,
        posting: PostingService,
        wallets: WalletResolver,
        ids: IdGenerator,
        clock: EventClock,
        env: Env,
        audit: AuditService,
      ): FundingService =>
        new FundingService(
          ledger,
          posting,
          wallets,
          ids,
          clock,
          {
            enabled: env.DEV_FUNDING_ENABLED,
            maxMinor: BigInt(env.DEV_FUNDING_MAX_MINOR),
          },
          audit,
        ),
      inject: [LedgerStore, PostingService, WalletResolver, ID_GENERATOR, CLOCK, ENV, AuditService],
    },
  ],
})
export class PaymentsModule {}
