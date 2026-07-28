import { Module } from '@nestjs/common';
import type { EventClock, IdGenerator } from '@fides/domain';
import { DRIZZLE } from '../../database/database.module';
import type { Database } from '../../database/db.types';
import { CLOCK, ID_GENERATOR } from '../../shared/tokens';
import { AuditService } from './application/audit.service';

/**
 * Audit module (Slice 6, ADR-0024): the append-only, hash-chained audit trail.
 * A dependency leaf — it needs only the database, id generator, and clock, so
 * any module can import it to record sensitive actions without a cycle. Sensitive
 * actions call `AuditService.append` inside their own transaction.
 */
@Module({
  providers: [
    {
      provide: AuditService,
      useFactory: (db: Database, ids: IdGenerator, clock: EventClock): AuditService =>
        new AuditService(db, ids, clock),
      inject: [DRIZZLE, ID_GENERATOR, CLOCK],
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}
