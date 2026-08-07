import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ENV, type Env } from '../config/env';
import { AdminSweeper } from '../modules/admin/application/admin-sweeper';
import { AuditAnchorService } from '../modules/audit/application/audit-anchor.service';
import { IdentitySweeper } from '../modules/identity/application/identity-sweeper';
import { OutboxDispatcher } from '../shared/outbox/outbox.dispatcher';

export const OUTBOX_DISPATCH_INTERVAL = 'outbox-dispatch';
export const IDENTITY_SWEEP_INTERVAL = 'identity-sweep';
export const AUDIT_ANCHOR_INTERVAL = 'audit-anchor';

/**
 * Arms the background intervals (env-tunable, kill-switched via
 * SCHEDULERS_ENABLED): outbox dispatch keeps projections converging; the
 * sweepers apply the ADR-0021 retention policy to customer and back-office
 * security rows alike; and the anchor pass publishes the audit chain's signed
 * head (ADR-0031). Passes are overlap-guarded so a slow run is never stacked
 * on, and failures are logged, never swallowed.
 */
@Injectable()
export class OperationsScheduler implements OnModuleInit {
  private readonly logger = new Logger(OperationsScheduler.name);
  private dispatching = false;
  private sweeping = false;
  private anchoring = false;

  // Explicit tokens: esbuild-based test transforms emit no design:paramtypes.
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(OutboxDispatcher) private readonly dispatcher: OutboxDispatcher,
    @Inject(IdentitySweeper) private readonly sweeper: IdentitySweeper,
    @Inject(AdminSweeper) private readonly adminSweeper: AdminSweeper,
    @Inject(AuditAnchorService) private readonly anchors: AuditAnchorService,
    @Inject(SchedulerRegistry) private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (!this.env.SCHEDULERS_ENABLED) {
      this.logger.log('Background schedulers disabled (SCHEDULERS_ENABLED=false)');
      return;
    }
    this.registry.addInterval(
      OUTBOX_DISPATCH_INTERVAL,
      setInterval(() => void this.dispatchOutbox(), this.env.OUTBOX_DISPATCH_INTERVAL_MS),
    );
    this.registry.addInterval(
      IDENTITY_SWEEP_INTERVAL,
      setInterval(() => void this.sweepIdentity(), this.env.CLEANUP_INTERVAL_MS),
    );
    this.registry.addInterval(
      AUDIT_ANCHOR_INTERVAL,
      setInterval(() => void this.publishAuditAnchor(), this.env.AUDIT_ANCHOR_INTERVAL_MS),
    );
    this.logger.log(
      `Schedulers armed: outbox every ${this.env.OUTBOX_DISPATCH_INTERVAL_MS} ms, ` +
        `sweep every ${this.env.CLEANUP_INTERVAL_MS} ms, ` +
        `audit anchor every ${this.env.AUDIT_ANCHOR_INTERVAL_MS} ms`,
    );
  }

  /**
   * Publish the audit chain's signed head (ADR-0031); also callable directly
   * (tests, manual operations). A pass that finds nothing new is silent — the
   * previous anchor already pins that position, and republishing it every
   * interval would fill a log archive with identical claims on an idle system.
   *
   * A failure here is logged as an **error**, not a warning: the anchor is the
   * only thing standing between a truncated trail and an undetected one, so a
   * publisher that has quietly stopped is a security event rather than noise.
   */
  async publishAuditAnchor(): Promise<void> {
    if (this.anchoring) return;
    this.anchoring = true;
    try {
      await this.anchors.publish();
    } catch (error) {
      this.logger.error(
        'Audit anchor publication failed; the trail is unanchored until this succeeds',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.anchoring = false;
    }
  }

  /** One outbox drain pass; also callable directly (tests, manual operations). */
  async dispatchOutbox(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const result = await this.dispatcher.dispatchPending();
      if (result.failed > 0) {
        this.logger.warn(`Outbox dispatch: ${result.failed} event(s) failed and will retry`);
      }
    } catch (error) {
      this.logger.error(
        'Outbox dispatch pass failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.dispatching = false;
    }
  }

  /**
   * One retention sweep across the customer and back-office security rows; also
   * callable directly (tests, manual operations).
   */
  async sweepIdentity(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const result = await this.sweeper.sweep();
      const admin = await this.adminSweeper.sweep();
      const total =
        result.scaGrants +
        result.webauthnChallenges +
        result.enrolmentTokens +
        result.emailVerifications +
        result.sessions +
        admin.loginChallenges +
        admin.sessions;
      if (total > 0) this.logger.log(`Swept ${total} dead security row(s)`);
    } catch (error) {
      this.logger.error(
        'Security sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.sweeping = false;
    }
  }
}
