import { Global, Module } from '@nestjs/common';
import { UuidV7Generator } from './ids/uuid-v7';
import { ConsoleNotificationAdapter } from './notifications/console-notification.adapter';
import { SystemClock } from './time/system-clock';
import { CLOCK, ID_GENERATOR, NOTIFICATIONS } from './tokens';

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
  ],
  exports: [ID_GENERATOR, CLOCK, NOTIFICATIONS],
})
export class SharedModule {}
