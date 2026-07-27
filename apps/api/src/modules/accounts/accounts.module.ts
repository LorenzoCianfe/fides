import { Module } from '@nestjs/common';
import type { IdGenerator } from '@fides/domain';
import { DRIZZLE } from '../../database/database.module';
import type { Database } from '../../database/db.types';
import { ID_GENERATOR } from '../../shared/tokens';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/application/audit.service';
import { IdentityModule } from '../identity/identity.module';
import { LedgerStore } from '../ledger/infra/ledger.repository';
import { LedgerModule } from '../ledger/ledger.module';
import { AccountProvisioningService } from './application/account-provisioning.service';
import { AccountService } from './application/account.service';
import { WalletResolver } from './application/wallet-resolver';
import { AccountsController } from './http/accounts.controller';
import { WalletsController } from './http/wallets.controller';

/**
 * Accounts module (Slice 4): account and wallet structure. Provisioning runs
 * event-driven off `kyc.approved` (wired into the outbox dispatcher by
 * OperationsModule); the read surface serves `/v1/accounts`. Balances are never
 * stored here — they are read from the ledger projection via LedgerStore.
 * IdentityModule supplies the SessionAuthGuard the controller depends on.
 */
@Module({
  imports: [LedgerModule, IdentityModule, AuditModule],
  controllers: [AccountsController, WalletsController],
  providers: [
    {
      provide: AccountProvisioningService,
      useFactory: (
        ledger: LedgerStore,
        ids: IdGenerator,
        audit: AuditService,
      ): AccountProvisioningService => new AccountProvisioningService(ledger, ids, audit),
      inject: [LedgerStore, ID_GENERATOR, AuditService],
    },
    {
      provide: AccountService,
      useFactory: (db: Database, ledger: LedgerStore): AccountService =>
        new AccountService(db, ledger),
      inject: [DRIZZLE, LedgerStore],
    },
    {
      provide: WalletResolver,
      useFactory: (db: Database): WalletResolver => new WalletResolver(db),
      inject: [DRIZZLE],
    },
  ],
  exports: [AccountProvisioningService, AccountService, WalletResolver],
})
export class AccountsModule {}
