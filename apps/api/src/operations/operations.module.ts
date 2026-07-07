import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import type { EventClock } from '@fides/domain';
import { DRIZZLE } from '../database/database.module';
import type { Database } from '../database/db.types';
import { IdentitySweeper } from '../modules/identity/application/identity-sweeper';
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
 * the ADR-0021 retention sweeper, both driven by env-tunable intervals.
 */
@Module({
  imports: [ScheduleModule.forRoot(), LedgerModule],
  providers: [
    {
      provide: OutboxDispatcher,
      useFactory: (db: Database, projector: TransactionHistoryProjector): OutboxDispatcher =>
        new OutboxDispatcher(db, {
          [LEDGER_ENTRY_POSTED]: (tx, payload) =>
            projector.project(tx, payload as LedgerEntryPostedPayload),
        }),
      inject: [DRIZZLE, TransactionHistoryProjector],
    },
    {
      provide: IdentitySweeper,
      useFactory: (db: Database, clock: EventClock): IdentitySweeper =>
        new IdentitySweeper(db, clock),
      inject: [DRIZZLE, CLOCK],
    },
    OperationsScheduler,
  ],
  exports: [OutboxDispatcher, IdentitySweeper],
})
export class OperationsModule {}
