import { describe, expect, it } from 'vitest';
import type { AuditLogRow } from '../infra/audit.schema';
import {
  auditRecordCore,
  computeAuditHash,
  GENESIS_PREV_HASH,
  verifyAuditChain,
} from './audit.service';

/**
 * Pure break-detection tests for the audit chain (ADR-0024). The append-only DB
 * trigger blocks a real UPDATE/DELETE, so detection is proven here on crafted
 * rows: modification, forgery, deletion of a middle record, and reordering must
 * all be caught. `seal` links a chain exactly as `AuditService.append` does.
 */

const ACTOR = '00000000-0000-7000-8000-000000000001';

function baseRow(index: number): AuditLogRow {
  return {
    id: `00000000-0000-7000-8000-00000000000${index}`,
    seq: index,
    occurredAt: new Date(1_700_000_000_000 + index * 1_000),
    actorType: 'user',
    actorId: ACTOR,
    action: 'test.event',
    resourceType: 'test',
    resourceId: `r${index}`,
    before: null,
    after: null,
    correlationId: null,
    metadata: null,
    prevHash: GENESIS_PREV_HASH,
    hash: '',
    createdAt: new Date(1_700_000_000_000 + index * 1_000),
  };
}

/** Link a set of rows into a valid chain, sealing each hash from its predecessor. */
function seal(rows: AuditLogRow[]): AuditLogRow[] {
  let prevHash = GENESIS_PREV_HASH;
  return rows.map((row, index) => {
    const linked = { ...row, seq: index, prevHash };
    const hash = computeAuditHash(prevHash, auditRecordCore(linked));
    prevHash = hash;
    return { ...linked, hash };
  });
}

describe('verifyAuditChain', () => {
  it('accepts the empty chain', () => {
    expect(verifyAuditChain([])).toEqual({ ok: true, count: 0, brokenAtSeq: null });
  });

  it('accepts a well-formed chain linked from genesis', () => {
    const chain = seal([baseRow(0), baseRow(1), baseRow(2)]);
    expect(chain[0]!.prevHash).toBe(GENESIS_PREV_HASH);
    expect(chain[1]!.prevHash).toBe(chain[0]!.hash);
    expect(verifyAuditChain(chain)).toEqual({ ok: true, count: 3, brokenAtSeq: null });
  });

  it('detects a modified field (hash no longer recomputes)', () => {
    const chain = seal([baseRow(0), baseRow(1), baseRow(2)]);
    const tampered = [...chain];
    tampered[1] = { ...tampered[1]!, action: 'tampered' };
    expect(verifyAuditChain(tampered)).toEqual({ ok: false, count: 3, brokenAtSeq: 1 });
  });

  it('detects a forged hash that breaks the next link', () => {
    const chain = seal([baseRow(0), baseRow(1), baseRow(2)]);
    const forged = [...chain];
    // Recompute the tampered row's own hash so it self-verifies, as a naive
    // forger would — the break then surfaces at the *next* row's prevHash link.
    const rewritten = { ...forged[1]!, action: 'tampered' };
    forged[1] = {
      ...rewritten,
      hash: computeAuditHash(rewritten.prevHash, auditRecordCore(rewritten)),
    };
    expect(verifyAuditChain(forged)).toEqual({ ok: false, count: 3, brokenAtSeq: 2 });
  });

  it('detects a deleted middle record (seq gap and broken link)', () => {
    const chain = seal([baseRow(0), baseRow(1), baseRow(2)]);
    const withHole = [chain[0]!, chain[2]!];
    // chain[2].seq is 2 but its index is now 1 → contiguity break at seq 2.
    expect(verifyAuditChain(withHole)).toEqual({ ok: false, count: 2, brokenAtSeq: 2 });
  });

  it('detects reordered records', () => {
    const chain = seal([baseRow(0), baseRow(1), baseRow(2)]);
    const swapped = [chain[0]!, chain[2]!, chain[1]!];
    expect(verifyAuditChain(swapped).ok).toBe(false);
  });

  it('detects a genesis whose predecessor is not the zero hash', () => {
    const [genesis] = seal([baseRow(0)]);
    const detached = { ...genesis!, prevHash: 'f'.repeat(64) };
    expect(verifyAuditChain([detached])).toEqual({ ok: false, count: 1, brokenAtSeq: 0 });
  });
});
