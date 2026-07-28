import type { EventClock } from '@fides/domain';

/** Wall-clock time source for application services. */
export class SystemClock implements EventClock {
  now(): Date {
    return new Date();
  }
}
