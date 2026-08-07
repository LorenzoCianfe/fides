import { Inject, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import type { EventClock, IdGenerator } from '@fides/domain';
import { DRIZZLE } from '../../database/database.module';
import type { Database } from '../../database/db.types';
import type { SigningPort } from '../../shared/crypto/signing';
import { CLOCK, ID_GENERATOR, SIGNING } from '../../shared/tokens';
import { AuditAnchorService } from './application/audit-anchor.service';
import { AuditService } from './application/audit.service';

/**
 * Audit module (Slice 6, ADR-0024; anchoring added in Slice 11, ADR-0031): the
 * append-only, hash-chained audit trail and the signed high-water anchors that
 * make truncating its tail detectable.
 *
 * A dependency leaf — it needs only the database, id generator, clock, and the
 * signing port — so any module can import it to record sensitive actions without
 * a cycle. Sensitive actions call `AuditService.append` inside their own
 * transaction; anchoring runs on the operations scheduler, outside them.
 */
@Module({
  providers: [
    {
      provide: AuditService,
      useFactory: (db: Database, ids: IdGenerator, clock: EventClock): AuditService =>
        new AuditService(db, ids, clock),
      inject: [DRIZZLE, ID_GENERATOR, CLOCK],
    },
    {
      provide: AuditAnchorService,
      useFactory: (
        db: Database,
        ids: IdGenerator,
        clock: EventClock,
        signing: SigningPort,
      ): AuditAnchorService => {
        // The sink is bound here rather than imported into the service, which
        // stays framework-free like every other application service. This log
        // line is the control (ADR-0031): the table beside it is convenience,
        // reachable by the same attacker who can truncate the trail.
        const logger = new Logger('AuditAnchor');
        return new AuditAnchorService(db, ids, clock, signing, (line) => logger.log(line));
      },
      inject: [DRIZZLE, ID_GENERATOR, CLOCK, SIGNING],
    },
  ],
  exports: [AuditService, AuditAnchorService],
})
export class AuditModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuditModule.name);

  constructor(@Inject(SIGNING) private readonly signing: SigningPort) {}

  /**
   * Announce the anchor verification key at startup.
   *
   * An anchor is only worth anything to someone who can check it, and checking
   * needs the public key from a channel the signer does not control. Emitting it
   * here puts it in the same log archive as the anchors themselves, at a known
   * point, so it can be pinned once and compared forever. It is public material
   * by construction: it verifies signatures and cannot make them.
   */
  onApplicationBootstrap(): void {
    this.logger.log(
      `Audit anchor verification key ${this.signing.primaryKeyId}: ${this.signing.publicKey()} ` +
        '(SPKI, base64 — pin this out of band to verify published anchors)',
    );
  }
}
