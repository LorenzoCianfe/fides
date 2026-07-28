import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ENV, type Env } from '../config/env';
import { AdminSweeper } from '../modules/admin/application/admin-sweeper';
import { IdentitySweeper } from '../modules/identity/application/identity-sweeper';
import { OutboxDispatcher } from '../shared/outbox/outbox.dispatcher';

export const OUTBOX_DISPATCH_INTERVAL = 'outbox-dispatch';
export const IDENTITY_SWEEP_INTERVAL = 'identity-sweep';

/**
 * Arms the background intervals (env-tunable, kill-switched via
 * SCHEDULERS_ENABLED): outbox dispatch keeps projections converging; the
 * sweepers apply the ADR-0021 retention policy to customer and back-office
 * security rows alike. Passes are overlap-guarded so a slow run is never
 * stacked on, and failures are logged, never swallowed.
 */
@Injectable()
export class OperationsScheduler implements OnModuleInit {
  private readonly logger = new Logger(OperationsScheduler.name);
  private dispatching = false;
  private sweeping = false;

  // Explicit tokens: esbuild-based test transforms emit no design:paramtypes.
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(OutboxDispatcher) private readonly dispatcher: OutboxDispatcher,
    @Inject(IdentitySweeper) private readonly sweeper: IdentitySweeper,
    @Inject(AdminSweeper) private readonly adminSweeper: AdminSweeper,
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
    this.logger.log(
      `Schedulers armed: outbox every ${this.env.OUTBOX_DISPATCH_INTERVAL_MS} ms, ` +
        `sweep every ${this.env.CLEANUP_INTERVAL_MS} ms`,
    );
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
