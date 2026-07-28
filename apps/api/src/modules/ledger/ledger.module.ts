import { Module } from '@nestjs/common';
import type { EventClock, IdGenerator } from '@fides/domain';
import { DRIZZLE } from '../../database/database.module';
import type { Database } from '../../database/db.types';
import { CLOCK, ID_GENERATOR } from '../../shared/tokens';
import { PostingService } from './application/posting.service';
import { TransactionHistoryProjector } from './application/transaction-history.projector';
import { TransactionHistoryReader } from './application/transaction-history.reader';
import { LedgerStore } from './infra/ledger.repository';

/**
 * Ledger module: the double-entry system of record. No HTTP surface yet —
 * balance and history endpoints arrive with the transfer slice; the providers
 * are bound now for the outbox dispatcher and the coming account provisioning.
 */
@Module({
  providers: [
    {
      provide: LedgerStore,
      useFactory: (db: Database, ids: IdGenerator): LedgerStore => new LedgerStore(db, ids),
      inject: [DRIZZLE, ID_GENERATOR],
    },
    {
      provide: PostingService,
      useFactory: (db: Database, ids: IdGenerator, clock: EventClock): PostingService =>
        new PostingService(db, ids, clock),
      inject: [DRIZZLE, ID_GENERATOR, CLOCK],
    },
    {
      provide: TransactionHistoryProjector,
      useFactory: (ids: IdGenerator): TransactionHistoryProjector =>
        new TransactionHistoryProjector(ids),
      inject: [ID_GENERATOR],
    },
    {
      provide: TransactionHistoryReader,
      useFactory: (db: Database): TransactionHistoryReader => new TransactionHistoryReader(db),
      inject: [DRIZZLE],
    },
  ],
  exports: [LedgerStore, PostingService, TransactionHistoryProjector, TransactionHistoryReader],
})
export class LedgerModule {}
