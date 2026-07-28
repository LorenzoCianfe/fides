import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import type { EventClock } from '@fides/domain';
import { DRIZZLE } from '../database/database.module';
import type { Database } from '../database/db.types';
import { AccountsModule } from '../modules/accounts/accounts.module';
import { AccountProvisioningService } from '../modules/accounts/application/account-provisioning.service';
import { AdminModule } from '../modules/admin/admin.module';
import { IdentitySweeper } from '../modules/identity/application/identity-sweeper';
import { KYC_APPROVED_EVENT, type KycApprovedPayload } from '../modules/kyc/application/kyc-events';
import {
  LEDGER_ENTRY_POSTED,
  type LedgerEntryPostedPayload,
} from '../modules/ledger/application/ledger-events';
import { TransactionHistoryProjector } from '../modules/ledger/application/transaction-history.projector';
import { LedgerModule } from '../modules/ledger/ledger.module';
import { OutboxDispatcher } from '../shared/outbox/outbox.dispatcher';
import { CLOCK } from '../shared/tokens';
import { OperationsScheduler } from './operations.scheduler';

/**
 * Background operations: the outbox dispatcher with its handler registry
 * (event types without a handler stay pending for their future consumer) and
 * the ADR-0021 retention sweepers — customer and back-office — all driven by
 * env-tunable intervals.
 */
@Module({
  imports: [ScheduleModule.forRoot(), LedgerModule, AccountsModule, AdminModule],
  providers: [
    {
      provide: OutboxDispatcher,
      useFactory: (
        db: Database,
        projector: TransactionHistoryProjector,
        provisioning: AccountProvisioningService,
      ): OutboxDispatcher =>
        new OutboxDispatcher(db, {
          [LEDGER_ENTRY_POSTED]: (tx, payload) =>
            projector.project(tx, payload as LedgerEntryPostedPayload),
          [KYC_APPROVED_EVENT]: (tx, payload) =>
            provisioning.provisionForApprovedKyc(tx, payload as KycApprovedPayload),
        }),
      inject: [DRIZZLE, TransactionHistoryProjector, AccountProvisioningService],
    },
    {
      provide: IdentitySweeper,
      useFactory: (db: Database, clock: EventClock): IdentitySweeper =>
        new IdentitySweeper(db, clock),
      inject: [DRIZZLE, CLOCK],
    },
    OperationsScheduler,
  ],
  // AdminSweeper is consumed here but owned and exported by AdminModule, so it
  // is not re-exported: a module may only export its own providers.
  exports: [OutboxDispatcher, IdentitySweeper],
})
export class OperationsModule {}
