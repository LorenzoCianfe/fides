import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { KeyringEncryption, parseKeyring } from './crypto/encryption';
import { UuidV7Generator } from './ids/uuid-v7';
import { ConsoleNotificationAdapter } from './notifications/console-notification.adapter';
import { SystemClock } from './time/system-clock';
import { CLOCK, ENCRYPTION, ID_GENERATOR, NOTIFICATIONS } from './tokens';

/** Binds the shared, framework-free platform services into the container. */
@Global()
@Module({
  providers: [
    { provide: ID_GENERATOR, useFactory: (): UuidV7Generator => new UuidV7Generator() },
    { provide: CLOCK, useFactory: (): SystemClock => new SystemClock() },
    {
      provide: NOTIFICATIONS,
      useFactory: (): ConsoleNotificationAdapter => new ConsoleNotificationAdapter(),
    },
    {
      // Built at boot so a malformed or wrong-sized key fails startup rather
      // than the first admin sign-in (ADR-0028).
      provide: ENCRYPTION,
      useFactory: (env: Env): KeyringEncryption =>
        new KeyringEncryption(parseKeyring(env.ENCRYPTION_KEYS)),
      inject: [ENV],
    },
  ],
  exports: [ID_GENERATOR, CLOCK, NOTIFICATIONS, ENCRYPTION],
})
export class SharedModule {}
