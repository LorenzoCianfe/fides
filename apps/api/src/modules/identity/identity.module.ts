import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { EventClock, IdGenerator } from '@fides/domain';
import { ENV, type Env } from '../../config/env';
import { DRIZZLE } from '../../database/database.module';
import type { Database } from '../../database/db.types';
import type { NotificationPort } from '../../shared/notifications/notification.port';
import { CLOCK, ID_GENERATOR, NOTIFICATIONS } from '../../shared/tokens';
import { KYC_PORT, type KycPort } from '../kyc/application/kyc.port';
import { KycModule } from '../kyc/kyc.module';
import { SessionAuthGuard } from './application/auth.guard';
import { EmailVerificationService } from './application/email-verification.service';
import { RegistrationService } from './application/registration.service';
import {
  DEFAULT_SESSION_CONFIG,
  SessionService,
  type SessionConfig,
} from './application/session.service';
import { WebAuthnService, type WebAuthnConfig } from './application/webauthn.service';
import { AuthController } from './http/auth.controller';
import { ScaController } from './http/sca.controller';
import { SessionsController } from './http/sessions.controller';

function sessionConfigFromEnv(env: Env): SessionConfig {
  return {
    accessTtlMs: env.SESSION_ACCESS_TTL_MS ?? DEFAULT_SESSION_CONFIG.accessTtlMs,
    refreshIdleTtlMs: env.SESSION_REFRESH_IDLE_TTL_MS ?? DEFAULT_SESSION_CONFIG.refreshIdleTtlMs,
    absoluteTtlMs: env.SESSION_ABSOLUTE_TTL_MS ?? DEFAULT_SESSION_CONFIG.absoluteTtlMs,
  };
}

function webauthnConfigFromEnv(env: Env): WebAuthnConfig {
  return { rpId: env.WEBAUTHN_RP_ID, rpName: env.APP_NAME, origins: env.WEBAUTHN_ORIGINS };
}

/**
 * Identity module (ADR-0007, ADR-0020, ADR-0021): onboarding, WebAuthn
 * ceremonies, sessions, and SCA step-up, exposed over `/v1/auth`. The
 * application services are framework-free classes bound here by factories;
 * the throttler is module-scoped with an env kill-switch.
 */
@Module({
  imports: [
    KycModule,
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 10 }],
        skipIf: (): boolean => !env.THROTTLE_ENABLED,
      }),
    }),
  ],
  controllers: [AuthController, SessionsController, ScaController],
  providers: [
    {
      provide: SessionService,
      useFactory: (db: Database, ids: IdGenerator, clock: EventClock, env: Env): SessionService =>
        new SessionService(db, ids, clock, sessionConfigFromEnv(env)),
      inject: [DRIZZLE, ID_GENERATOR, CLOCK, ENV],
    },
    {
      provide: WebAuthnService,
      useFactory: (
        db: Database,
        ids: IdGenerator,
        clock: EventClock,
        sessions: SessionService,
        env: Env,
      ): WebAuthnService =>
        new WebAuthnService(db, ids, clock, sessions, webauthnConfigFromEnv(env)),
      inject: [DRIZZLE, ID_GENERATOR, CLOCK, SessionService, ENV],
    },
    {
      provide: RegistrationService,
      useFactory: (
        db: Database,
        ids: IdGenerator,
        clock: EventClock,
        kyc: KycPort,
        notifications: NotificationPort,
      ): RegistrationService => new RegistrationService(db, ids, clock, kyc, notifications),
      inject: [DRIZZLE, ID_GENERATOR, CLOCK, KYC_PORT, NOTIFICATIONS],
    },
    {
      provide: EmailVerificationService,
      useFactory: (
        db: Database,
        ids: IdGenerator,
        clock: EventClock,
        notifications: NotificationPort,
      ): EmailVerificationService => new EmailVerificationService(db, ids, clock, notifications),
      inject: [DRIZZLE, ID_GENERATOR, CLOCK, NOTIFICATIONS],
    },
    SessionAuthGuard,
  ],
  exports: [SessionService, SessionAuthGuard],
})
export class IdentityModule {}
