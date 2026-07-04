import type { DomainEvent } from './domain-event';

/**
 * Transactional outbox primitives.
 *
 * State changes and their events are written in the same database transaction:
 * the domain mutation and an outbox row commit atomically. A dispatcher later
 * relays pending rows to consumers, giving at-least-once delivery without
 * two-phase commit.
 */

export const OutboxStatus = {
  Pending: 'pending',
  Dispatched: 'dispatched',
  Failed: 'failed',
} as const;

export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];

export interface OutboxRecord {
  /** Equal to the source event's `eventId`. */
  readonly id: string;
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: unknown;
  readonly occurredAt: Date;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly correlationId?: string;
  readonly causationId?: string;
}

/** Map a domain event to a fresh, pending outbox record. */
export function toOutboxRecord(event: DomainEvent): OutboxRecord {
  return {
    id: event.eventId,
    type: event.type,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payload: event.payload,
    occurredAt: event.occurredAt,
    status: OutboxStatus.Pending,
    attempts: 0,
    ...(event.correlationId !== undefined ? { correlationId: event.correlationId } : {}),
    ...(event.causationId !== undefined ? { causationId: event.causationId } : {}),
  };
}
