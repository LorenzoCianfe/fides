import { describe, expect, it } from 'vitest';
import {
  createDomainEvent,
  type EventClock,
  type IdGenerator,
  isDomainEvent,
} from './domain-event';
import { OutboxStatus, toOutboxRecord } from './outbox';

const fixedClock = (iso: string): EventClock => ({ now: () => new Date(iso) });

const sequentialIds = (prefix = 'evt_'): IdGenerator => {
  let n = 0;
  return { next: () => `${prefix}${++n}` };
};

const deps = () => ({ ids: sequentialIds(), clock: fixedClock('2026-07-04T12:00:00.000Z') });

describe('createDomainEvent', () => {
  it('assembles an event from injected id and clock', () => {
    const event = createDomainEvent(
      {
        type: 'ledger.entry.posted',
        aggregateType: 'ledger_account',
        aggregateId: 'acc_1',
        payload: { amount: 100 },
      },
      deps(),
    );
    expect(event.eventId).toBe('evt_1');
    expect(event.occurredAt.toISOString()).toBe('2026-07-04T12:00:00.000Z');
    expect(event.version).toBe(1);
    expect(event.payload).toEqual({ amount: 100 });
    expect(event.correlationId).toBeUndefined();
  });

  it('honors an explicit version and correlation/causation ids', () => {
    const event = createDomainEvent(
      {
        type: 'card.frozen',
        aggregateType: 'card',
        aggregateId: 'card_1',
        payload: {},
        version: 3,
        correlationId: 'corr_1',
        causationId: 'cause_1',
      },
      deps(),
    );
    expect(event.version).toBe(3);
    expect(event.correlationId).toBe('corr_1');
    expect(event.causationId).toBe('cause_1');
  });

  it('recognizes valid events via the guard', () => {
    const event = createDomainEvent(
      { type: 't', aggregateType: 'a', aggregateId: '1', payload: null },
      deps(),
    );
    expect(isDomainEvent(event)).toBe(true);
    expect(isDomainEvent({})).toBe(false);
    expect(isDomainEvent(null)).toBe(false);
  });
});

describe('toOutboxRecord', () => {
  it('maps an event to a fresh pending record', () => {
    const event = createDomainEvent(
      {
        type: 'ledger.entry.posted',
        aggregateType: 'ledger_account',
        aggregateId: 'acc_1',
        payload: { x: 1 },
        correlationId: 'corr_9',
      },
      deps(),
    );
    const record = toOutboxRecord(event);
    expect(record.id).toBe(event.eventId);
    expect(record.status).toBe(OutboxStatus.Pending);
    expect(record.attempts).toBe(0);
    expect(record.correlationId).toBe('corr_9');
    expect(record.payload).toEqual({ x: 1 });
    expect(record.occurredAt).toBe(event.occurredAt);
  });
});
