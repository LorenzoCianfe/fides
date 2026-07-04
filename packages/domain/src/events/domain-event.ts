/**
 * Domain event primitives.
 *
 * Every economic or state-changing action emits a `DomainEvent`. Events are
 * persisted through the transactional outbox (see `outbox.ts`) for auditability,
 * read-model projection, and eventual integration.
 *
 * Event creation takes an explicit clock and id generator so it stays pure and
 * deterministically testable — no hidden `Date.now()` / random calls.
 */

export interface DomainEvent<TPayload = unknown> {
  /** Globally unique event identifier (also the outbox row id). */
  readonly eventId: string;
  /** Dotted event type, e.g. `ledger.entry.posted`. */
  readonly type: string;
  /** Aggregate root type this event belongs to, e.g. `ledger_account`. */
  readonly aggregateType: string;
  /** Identifier of the aggregate instance. */
  readonly aggregateId: string;
  readonly payload: TPayload;
  readonly occurredAt: Date;
  /** Schema version of this event type. */
  readonly version: number;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface DomainEventInput<TPayload = unknown> {
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: TPayload;
  readonly version?: number;
  readonly correlationId?: string;
  readonly causationId?: string;
}

/** Injected time source. */
export interface EventClock {
  now(): Date;
}

/** Injected identifier source (e.g. a UUID v7 generator). */
export interface IdGenerator {
  next(): string;
}

export function createDomainEvent<TPayload>(
  input: DomainEventInput<TPayload>,
  deps: { readonly ids: IdGenerator; readonly clock: EventClock },
): DomainEvent<TPayload> {
  return {
    eventId: deps.ids.next(),
    type: input.type,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    payload: input.payload,
    occurredAt: deps.clock.now(),
    version: input.version ?? 1,
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    ...(input.causationId !== undefined ? { causationId: input.causationId } : {}),
  };
}

export function isDomainEvent(value: unknown): value is DomainEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.eventId === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.aggregateType === 'string' &&
    typeof candidate.aggregateId === 'string' &&
    candidate.occurredAt instanceof Date &&
    typeof candidate.version === 'number' &&
    'payload' in candidate
  );
}
