import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, type TestDatabase } from '../../../test/db';
import { Ed25519Signing, parseSigningKeyring } from '../../shared/crypto/signing';
import { UuidV7Generator } from '../../shared/ids/uuid-v7';
import { SystemClock } from '../../shared/time/system-clock';
import {
  ANCHOR_LOG_TAG,
  AuditAnchorService,
  parseAnchorPayload,
} from './application/audit-anchor.service';
import { AuditService, type AuditRecordInput } from './application/audit.service';
import { auditAnchors, auditLog } from './infra/audit.schema';

const ACTOR = '00000000-0000-7000-8000-000000000001';

/** A PKCS8-wrapped Ed25519 seed: the fixed DER prefix plus 32 bytes. */
function seededKey(fill: number): string {
  return Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.alloc(32, fill),
  ]).toString('base64');
}

const ids = new UuidV7Generator();
const clock = new SystemClock();
const { db, close } = createTestDb();
const audit = new AuditService(db as TestDatabase, ids, clock);
const signing = new Ed25519Signing(parseSigningKeyring(`k1:${seededKey(1)}`));

/** Every line the publisher emitted, in order — the copy that is the real control. */
let published: string[] = [];

function anchorService(port = signing): AuditAnchorService {
  return new AuditAnchorService(db as TestDatabase, ids, clock, port, (line) =>
    published.push(line),
  );
}

/** Append one record in its own transaction, as every real caller does. */
function append(overrides: Partial<AuditRecordInput> = {}): Promise<void> {
  return db.transaction((tx) =>
    audit.append(tx, {
      actorType: 'user',
      actorId: ACTOR,
      action: 'test.event',
      resourceType: 'test',
      resourceId: 'r1',
      ...overrides,
    }),
  );
}

/**
 * Delete the newest `count` records. The append-only trigger forbids DELETE, so
 * this disables it for the statement — which is exactly the privilege level the
 * threat model assumes: someone who can already bypass the database's own
 * guards. If truncation needed no such privilege, the chain would catch it.
 */
async function truncateTail(count: number): Promise<void> {
  await db.execute(sql`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`);
  await db.execute(
    sql`DELETE FROM audit_log WHERE seq IN (SELECT seq FROM audit_log ORDER BY seq DESC LIMIT ${count})`,
  );
  await db.execute(sql`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`);
}

/**
 * The text of a database rejection, flattened across the cause chain — drizzle
 * wraps the driver error, so the trigger's own message is never the outer one.
 */
async function dbErrorText(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return '';
  } catch (error) {
    const parts: string[] = [];
    let current: unknown = error;
    while (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    }
    return parts.join(' | ');
  }
}

beforeEach(async () => {
  await resetDb(db as TestDatabase);
  published = [];
});

afterAll(async () => {
  await close();
});

describe('audit anchor publication (ADR-0031)', () => {
  it('publishes the signed head to the log and stores a copy', async () => {
    await append();
    await append({ resourceId: 'r2' });

    const anchor = await anchorService().publish();
    expect(anchor).not.toBeNull();
    expect(anchor!.claim).toMatchObject({ seq: 1, keyId: 'k1' });

    // The log line is the control, so it must actually be emitted, be one line,
    // and carry everything a verifier needs.
    expect(published).toHaveLength(1);
    const [tag, payload, signature] = published[0]!.split(' ');
    expect(tag).toBe(ANCHOR_LOG_TAG);
    expect(published[0]).not.toContain('\n');
    expect(signing.verify(payload!, signature!)).toBe(true);
    expect(parseAnchorPayload(payload!).seq).toBe(1);

    const [stored] = await db.select().from(auditAnchors);
    expect(stored).toMatchObject({ seq: 1, payload, signature });
  });

  it('says nothing when the head has not moved', async () => {
    // Republishing an identical claim every interval would fill a log archive
    // with noise on an idle system; the existing anchor already pins the head.
    await append();
    const service = anchorService();
    expect(await service.publish()).not.toBeNull();
    expect(await service.publish()).toBeNull();
    expect(published).toHaveLength(1);

    await append({ resourceId: 'r2' });
    expect(await service.publish()).not.toBeNull();
    expect(published).toHaveLength(2);
  });

  it('anchors nothing while the trail is empty', async () => {
    expect(await anchorService().publish()).toBeNull();
    expect(published).toEqual([]);
  });

  it('refuses to let a stored anchor be edited', async () => {
    // Not the control — whoever can drop the trigger can drop the rows — but it
    // raises tampering from a single UPDATE to a schema change.
    await append();
    await anchorService().publish();
    await expect(
      dbErrorText(
        db
          .update(auditAnchors)
          .set({ seq: 0 })
          .where(sql`true`),
      ),
    ).resolves.toMatch(/append-only violation/);
  });
});

describe('audit tail verification (ADR-0031)', () => {
  it('reports an intact tail when the chain still reaches the anchor', async () => {
    await append();
    const service = anchorService();
    await service.publish();
    await append({ resourceId: 'r2' });

    expect(await service.verifyTail()).toMatchObject({
      status: 'intact',
      headSeq: 1,
      anchoredSeq: 0,
    });
  });

  it('detects the truncation the hash chain cannot', async () => {
    // The gap ADR-0024 recorded and deferred. Three records, anchored, then the
    // newest two deleted: the remaining chain verifies perfectly.
    await append();
    await append({ resourceId: 'r2' });
    await append({ resourceId: 'r3' });
    const service = anchorService();
    await service.publish();

    await truncateTail(2);

    expect(await audit.verify()).toMatchObject({ ok: true, count: 1 });
    const tail = await service.verifyTail();
    expect(tail.status).toBe('truncated');
    expect(tail).toMatchObject({ headSeq: 0, anchoredSeq: 2 });
    expect(tail.detail).toContain('anchored at 2');
  });

  it('detects history rewritten beneath the anchor', async () => {
    // The position survives but no longer holds the attested record.
    await append();
    await append({ resourceId: 'r2' });
    const service = anchorService();
    await service.publish();

    await db.execute(sql`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`);
    await db.execute(sql`UPDATE audit_log SET hash = 'rewritten' WHERE seq = 1`);
    await db.execute(sql`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`);

    const tail = await service.verifyTail();
    expect(tail.status).toBe('truncated');
    expect(tail.detail).toContain('no longer matches the anchored hash');
  });

  it('reports "unanchored" rather than "intact" when no anchor survives', async () => {
    // The honest answer. A freshly-deployed system and one whose anchors were
    // all deleted look identical from inside the database — which is precisely
    // why anchors are also published off-host.
    await append();
    const tail = await anchorService().verifyTail();
    expect(tail.status).toBe('unanchored');
    expect(tail.headSeq).toBe(0);
  });

  it('reports an anchor signed by a key outside the ring as unverifiable', async () => {
    await append();
    // Published under a key this verifier does not have — an anchor forged by
    // someone who could write the row but not reach the signing key.
    const foreign = new Ed25519Signing(parseSigningKeyring(`k1:${seededKey(9)}`));
    await anchorService(foreign).publish();

    const tail = await anchorService().verifyTail();
    expect(tail.status).toBe('anchor_unverifiable');
    expect(tail.detail).toContain('signature does not verify');
  });
});

describe('verifying against an anchor from the log archive (ADR-0031)', () => {
  /** Take the anchor as an operator would: off the published line, not the table. */
  function fromLog(line: string): { payload: string; signature: string } {
    const [, payload, signature] = line.split(' ');
    return { payload: payload!, signature: signature! };
  }

  it('still detects truncation after the anchor table itself is destroyed', async () => {
    // The scenario the whole design exists for: an attacker with database access
    // deletes the records *and* the anchors that would have betrayed them.
    await append();
    await append({ resourceId: 'r2' });
    await append({ resourceId: 'r3' });
    const service = anchorService();
    await service.publish();
    const archived = fromLog(published[0]!);

    await truncateTail(2);
    await db.execute(sql`TRUNCATE TABLE audit_anchors`);

    // In-database verification is now blind, exactly as expected...
    expect(await service.verifyTail()).toMatchObject({ status: 'unanchored' });
    // ...and the copy that left the host still convicts.
    const external = await service.verifyAgainstAnchor(archived.payload, archived.signature);
    expect(external).toMatchObject({ signatureValid: true, status: 'truncated', anchoredSeq: 2 });
  });

  it('confirms an intact trail', async () => {
    await append();
    const service = anchorService();
    await service.publish();
    await append({ resourceId: 'r2' });

    const archived = fromLog(published[0]!);
    expect(await service.verifyAgainstAnchor(archived.payload, archived.signature)).toMatchObject({
      signatureValid: true,
      status: 'intact',
    });
  });

  it('rejects a forged anchor rather than trusting the claim in it', async () => {
    await append();
    const service = anchorService();
    await service.publish();
    const archived = fromLog(published[0]!);

    // The obvious attack: keep a real signature, raise the seq it claims, and
    // try to make an intact trail look truncated (or the reverse).
    const tampered = archived.payload.replace('"seq":0', '"seq":99');
    const result = await service.verifyAgainstAnchor(tampered, archived.signature);
    expect(result.signatureValid).toBe(false);
    expect(result.status).toBe('anchor_unverifiable');
  });

  it('raises on a payload that is not an anchor at all', async () => {
    const service = anchorService();
    await expect(service.verifyAgainstAnchor('not json', 'fsig$v1$k1$AAAA')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(service.verifyAgainstAnchor('{"seq":1}', 'fsig$v1$k1$AAAA')).rejects.toMatchObject(
      { code: 'VALIDATION_FAILED' },
    );
  });
});

describe('the chain and the tail answer different questions', () => {
  it('keeps chain verification blind to truncation, which is why the anchor exists', async () => {
    for (let index = 0; index < 5; index++) await append({ resourceId: `r${index}` });
    expect(await audit.verify()).toMatchObject({ ok: true, count: 5 });

    await truncateTail(3);

    // Still ok. Every surviving link recomputes and the sequence is gap-free
    // from genesis — the chain simply cannot see what is no longer there.
    expect(await audit.verify()).toMatchObject({ ok: true, count: 2, brokenAtSeq: null });
    expect(await db.select().from(auditLog)).toHaveLength(2);
  });
});
