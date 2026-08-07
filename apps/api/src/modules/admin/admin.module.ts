import { Inject, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { EventClock, IdGenerator } from '@fides/domain';
import { ENV, type Env } from '../../config/env';
import { DRIZZLE } from '../../database/database.module';
import type { Database } from '../../database/db.types';
import { CLOCK, ENCRYPTION, ID_GENERATOR } from '../../shared/tokens';
import type { EncryptionPort } from '../../shared/crypto/encryption';
import { DEFAULT_TOTP_CONFIG } from '../../shared/crypto/totp';
import { AccountsModule } from '../accounts/accounts.module';
import { WalletResolver } from '../accounts/application/wallet-resolver';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/application/audit.service';
import { LedgerModule } from '../ledger/ledger.module';
import { LedgerStore } from '../ledger/infra/ledger.repository';
import { FundingService } from '../payments/application/funding.service';
import { PaymentsModule } from '../payments/payments.module';
import { AdminAuthGuard, AdminPermissionGuard } from './application/admin-auth.guard';
import {
  ADMIN_LOGIN_CHALLENGE_TTL_MS,
  AdminIdentityService,
  type AdminIdentityConfig,
} from './application/admin-identity.service';
import { AdminReadService } from './application/admin-read.service';
import {
  DEFAULT_ADMIN_SESSION_CONFIG,
  AdminSessionService,
  type AdminSessionConfig,
} from './application/admin-session.service';
import { AdminSweeper } from './application/admin-sweeper';
import { PendingAdminActionService } from './application/pending-admin-action.service';
import { AdminAuthController, AdminProfileController } from './http/admin-auth.controller';
import { AdminAuditController } from './http/admin-audit.controller';
import { AdminDirectoryController } from './http/admin-directory.controller';
import { AdminFourEyesController } from './http/admin-four-eyes.controller';
import { AdminStaffController } from './http/admin-staff.controller';

function adminSessionConfigFromEnv(env: Env): AdminSessionConfig {
  return {
    idleTtlMs: env.ADMIN_SESSION_IDLE_TTL_MS ?? DEFAULT_ADMIN_SESSION_CONFIG.idleTtlMs,
    absoluteTtlMs: env.ADMIN_SESSION_ABSOLUTE_TTL_MS ?? DEFAULT_ADMIN_SESSION_CONFIG.absoluteTtlMs,
  };
}

function adminIdentityConfigFromEnv(env: Env): AdminIdentityConfig {
  return {
    ...(env.ADMIN_BOOTSTRAP_EMAIL !== undefined
      ? { bootstrapEmail: env.ADMIN_BOOTSTRAP_EMAIL }
      : {}),
    ...(env.ADMIN_BOOTSTRAP_PASSWORD !== undefined
      ? { bootstrapPassword: env.ADMIN_BOOTSTRAP_PASSWORD }
      : {}),
    issuer: env.APP_NAME,
    loginChallengeTtlMs: ADMIN_LOGIN_CHALLENGE_TTL_MS,
    totp: DEFAULT_TOTP_CONFIG,
    lockoutThreshold: env.ADMIN_LOCKOUT_THRESHOLD,
    lockoutDurationMs: env.ADMIN_LOCKOUT_DURATION_MS,
  };
}

/**
 * Back office (ADR-0011, ADR-0025): a separate admin identity with RBAC, MFA,
 * shorter sessions, read-only views, and four-eyes on admin funding.
 *
 * The module depends on payments (for the funding execution path), accounts,
 * ledger, and audit — never the reverse — so no cycle is created and money
 * movement keeps a single implementation. It does **not** depend on the
 * identity module for authentication: admin and customer auth are deliberately
 * disjoint, and only the pure bearer-header parser is shared.
 */
@Module({
  imports: [
    AuditModule,
    AccountsModule,
    LedgerModule,
    PaymentsModule,
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 20 }],
        skipIf: (): boolean => !env.THROTTLE_ENABLED,
      }),
    }),
  ],
  controllers: [
    AdminAuthController,
    AdminProfileController,
    AdminStaffController,
    AdminDirectoryController,
    AdminAuditController,
    AdminFourEyesController,
  ],
  providers: [
    {
      provide: AdminSessionService,
      useFactory: (
        db: Database,
        ids: IdGenerator,
        clock: EventClock,
        audit: AuditService,
        env: Env,
      ): AdminSessionService =>
        new AdminSessionService(db, ids, clock, audit, adminSessionConfigFromEnv(env)),
      inject: [DRIZZLE, ID_GENERATOR, CLOCK, AuditService, ENV],
    },
    {
      provide: AdminIdentityService,
      useFactory: (
        db: Database,
        ids: IdGenerator,
        clock: EventClock,
        audit: AuditService,
        sessions: AdminSessionService,
        encryption: EncryptionPort,
        env: Env,
      ): AdminIdentityService =>
        new AdminIdentityService(
          db,
          ids,
          clock,
          audit,
          sessions,
          encryption,
          adminIdentityConfigFromEnv(env),
        ),
      inject: [DRIZZLE, ID_GENERATOR, CLOCK, AuditService, AdminSessionService, ENCRYPTION, ENV],
    },
    {
      provide: AdminReadService,
      useFactory: (db: Database, ledger: LedgerStore, clock: EventClock): AdminReadService =>
        new AdminReadService(db, ledger, clock),
      inject: [DRIZZLE, LedgerStore, CLOCK],
    },
    {
      provide: PendingAdminActionService,
      useFactory: (
        db: Database,
        ids: IdGenerator,
        clock: EventClock,
        audit: AuditService,
        wallets: WalletResolver,
        funding: FundingService,
        identity: AdminIdentityService,
      ): PendingAdminActionService =>
        new PendingAdminActionService(db, ids, clock, audit, wallets, funding, identity),
      inject: [
        DRIZZLE,
        ID_GENERATOR,
        CLOCK,
        AuditService,
        WalletResolver,
        FundingService,
        AdminIdentityService,
      ],
    },
    {
      provide: AdminSweeper,
      useFactory: (db: Database, clock: EventClock): AdminSweeper => new AdminSweeper(db, clock),
      inject: [DRIZZLE, CLOCK],
    },
    AdminAuthGuard,
    AdminPermissionGuard,
  ],
  exports: [AdminSessionService, AdminIdentityService, AdminSweeper],
})
export class AdminModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminModule.name);

  constructor(@Inject(AdminIdentityService) private readonly identity: AdminIdentityService) {}

  /**
   * Seed the first `super_admin` from configuration. Idempotent and a no-op
   * once any admin exists, so this is safe on every boot and cannot be used to
   * reset the back office.
   */
  async onApplicationBootstrap(): Promise<void> {
    const result = await this.identity.seedFirstAdmin();
    if (result.seeded) {
      this.logger.log(
        `Seeded the first super_admin (${result.adminId}); it must enrol a second factor at first login`,
      );
    }
  }
}
