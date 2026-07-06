import type { EventClock } from '@fides/domain';

/** A controllable clock for deterministic TTL and expiry tests. */
export class TestClock implements EventClock {
  private offsetMs = 0;

  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  advance(ms: number): void {
    this.offsetMs += ms;
  }

  reset(): void {
    this.offsetMs = 0;
  }
}
