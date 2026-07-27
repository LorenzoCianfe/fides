import { Money } from '@fides/domain';
import { asc, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, type TestDatabase } from '../../../test/db';
import type { IdempotencyContext } from '../../shared/idempotency/idempotency.service';
import { UuidV7Generator } from '../../shared/ids/uuid-v7';
import { SystemClock } from '../../shared/time/system-clock';
import { PostingService } from '../ledger/application/posting.service';
import { PostingDirection } from '../ledger/domain/account';
import { buildJournalEntry, type JournalEntry } from '../ledger/domain/journal-entry';
import { LedgerStore } from '../ledger/infra/ledger.repository';
import { AuditAction, AuditResource } from './application/audit-actions';
import {
  AuditService,
  GENESIS_PREV_HASH,
  type AuditRecordInput,
} from './application/audit.service';
import { auditLog } from './infra/audit.schema';

const ACTOR = '00000000-0000-7000-8000-000000000001';

const ids = new UuidV7Generator();
const clock = new SystemClock();
const { db, close } = createTestDb();
const audit = new AuditService(db as TestDatabase, ids, clock);
const store = new LedgerStore(db as TestDatabase, ids);
const posting = new PostingService(db as TestDatabase, ids, clock);

/** Append one record in its own transaction, as every real caller does. */
function append(
  overrides: Partial<AuditRecordInput> & Pick<AuditRecordInput, 'resourceId'>,
): Promise<void> {
  return db.transaction((tx) =>
    audit.append(tx, {
      actorType: 'user',
      actorId: ACTOR,
      action: 'test.event',
      resourceType: 'test',
      ...overrides,
    }),
  );
}

/** Capture a DB rejection, flattening the error's cause chain (as the ledger suite does). */
async function captureDbError(
  run: Promise<unknown>,
): Promise<{ rejected: boolean; text: string; code?: string }> {
  try {
    await run;
    return { rejected: false, text: '' };
  } catch (error) {
    const parts: string[] = [];
    let code: string | undefined;
    let current: unknown = error;
    while (current instanceof Error) {
      parts.push(current.message);
      const candidate = (current as { code?: unknown }).code;
      if (typeof candidate === 'string') code = candidate;
      current = current.cause;
    }
    return { rejected: true, text: parts.join(' | '), code };
  }
}

describe('audit trail (integration)', () => {
  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetDb(db as TestDatabase);
  });

  it('appends a gap-free chain, linked from genesis, that verifies', async () => {
    await append({ resourceId: 'r0' });
    await append({ resourceId: 'r1' });
    await append({ resourceId: 'r2' });

    const rows = await db.select().from(auditLog).orderBy(asc(auditLog.seq));
    expect(rows.map((row) => row.seq)).toEqual([0, 1, 2]);
    expect(rows[0]!.prevHash).toBe(GENESIS_PREV_HASH);
    expect(rows[1]!.prevHash).toBe(rows[0]!.hash);
    expect(rows[2]!.prevHash).toBe(rows[1]!.hash);

    expect(await audit.verify()).toEqual({ ok: true, count: 3, brokenAtSeq: null });
  });

  it('writes no record when the caller transaction rolls back (atomic)', async () => {
    await expect(
      db.transaction(async (tx) => {
        await audit.append(tx as unknown as TestDatabase, {
          actorType: 'user',
          actorId: ACTOR,
          action: 'test.event',
          resourceType: 'test',
          resourceId: 'r',
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it('forbids UPDATE and DELETE on the append-only audit trail', async () => {
    await append({ resourceId: 'r0' });
    const [row] = await db.select().from(auditLog);

    const onUpdate = await captureDbError(
      db.execute(sql`UPDATE audit_log SET action = 'tampered' WHERE id = ${row!.id}`),
    );
    expect(onUpdate.rejected).toBe(true);
    expect(onUpdate.code === '23001' || /append-only/i.test(onUpdate.text)).toBe(true);

    const onDelete = await captureDbError(
      db.execute(sql`DELETE FROM audit_log WHERE id = ${row!.id}`),
    );
    expect(onDelete.rejected).toBe(true);
    expect(onDelete.code === '23001' || /append-only/i.test(onDelete.text)).toBe(true);
  });

  it('detects an out-of-band tamper that bypassed the append-only trigger', async () => {
    await append({ resourceId: 'r0' });
    await append({ resourceId: 'r1' });
    await append({ resourceId: 'r2' });
    const rows = await db.select().from(auditLog).orderBy(asc(auditLog.seq));

    // Bypass the DB guard exactly as a privileged direct-SQL actor would, then
    // confirm the chain still catches the edit — the whole point of chaining.
    await db.execute(sql`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`);
    await db.execute(sql`UPDATE audit_log SET action = 'tampered' WHERE id = ${rows[1]!.id}`);
    await db.execute(sql`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`);

    const result = await audit.verify();
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(1);
  });

  it('records a posting once via onPosted; an idempotent replay adds none', async () => {
    const settlement = await store.ensureSystemAccount({
      type: 'asset',
      currency: 'EUR',
      code: 'system:settlement',
    });
    const wallet = await store.createAccount({
      type: 'liability',
      currency: 'EUR',
      code: `wallet:${ids.next()}`,
      system: false,
    });
    const amount = Money.fromMinor(1_000n, 'EUR');
    const idempotency: IdempotencyContext = {
      actorId: ACTOR,
      key: 'fund-once',
      fingerprint: 'fp',
      operation: 'funding',
    };

    const entry = (): JournalEntry =>
      buildJournalEntry({
        id: ids.next(),
        type: 'funding',
        occurredAt: clock.now(),
        postings: [
          { accountId: settlement.id, direction: PostingDirection.Debit, amount },
          { accountId: wallet.id, direction: PostingDirection.Credit, amount },
        ],
      });

    const executed = entry();
    const first = await posting.post({
      entry: executed,
      guardAccountIds: [],
      idempotency,
      onPosted: (tx, _now, posted) =>
        audit.append(tx, {
          actorType: 'user',
          actorId: ACTOR,
          action: AuditAction.DevFundingExecuted,
          resourceType: AuditResource.JournalEntry,
          resourceId: executed.id,
          metadata: {
            balanceAfterMinor:
              posted.balances.find((balance) => balance.accountId === wallet.id)?.balanceMinor ??
              null,
          },
        }),
    });
    // Same idempotency key, a fresh entry id: the replay must not re-audit.
    const replayed = entry();
    const second = await posting.post({
      entry: replayed,
      guardAccountIds: [],
      idempotency,
      onPosted: (tx, _now) =>
        audit.append(tx, {
          actorType: 'user',
          actorId: ACTOR,
          action: AuditAction.DevFundingExecuted,
          resourceType: AuditResource.JournalEntry,
          resourceId: replayed.id,
        }),
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);

    const rows = await db.select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe(AuditAction.DevFundingExecuted);
    // The recorded resource is the executed entry, never the replay's.
    expect(rows[0]!.resourceId).toBe(executed.id);
    expect(await audit.verify()).toEqual({ ok: true, count: 1, brokenAtSeq: null });
  });
});
