import { toOutboxRecord, type DomainEvent } from '@fides/domain';
import type { DatabaseTx } from '../../database/db.types';
import { outbox } from '../../database/schema/outbox';

/**
 * Append a domain event to the transactional outbox within an existing
 * transaction, so the event commits atomically with the state change that
 * produced it (ADR-0005).
 */
export async function appendToOutbox(tx: DatabaseTx, event: DomainEvent): Promise<void> {
  const record = toOutboxRecord(event);
  await tx.insert(outbox).values({
    id: record.id,
    type: record.type,
    aggregateType: record.aggregateType,
    aggregateId: record.aggregateId,
    payload: record.payload,
    occurredAt: record.occurredAt,
    status: record.status,
    attempts: record.attempts,
    correlationId: record.correlationId ?? null,
    causationId: record.causationId ?? null,
  });
}
