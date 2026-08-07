import { ValidationError, type EventClock, type IdGenerator } from '@fides/domain';
import { desc, eq } from 'drizzle-orm';
import type { Database } from '../../../database/db.types';
import { stableStringify } from '../../../shared/crypto/canonical';
import type { SigningPort } from '../../../shared/crypto/signing';
import { auditAnchors, auditLog } from '../infra/audit.schema';

/**
 * Audit tail anchoring (ADR-0031) — the gap ADR-0024 deferred.
 *
 * The hash chain proves that nothing it *contains* was altered or removed: every
 * link is recomputed from genesis. It proves nothing about what it no longer
 * contains. Delete the newest N records and the remainder is a shorter chain
 * that verifies perfectly, so an insider with database access can erase what
 * they just did and leave `verify()` answering `ok: true`.
 *
 * The fix is a high-water mark published somewhere the database cannot reach:
 * periodically, the head's `(seq, hash)` is signed with a key the database never
 * holds and emitted to the process log. Log shipping is the external medium
 * every deployment already has, and an attacker with total database access can
 * neither forge the signature nor retract a line that has already left the host.
 *
 * The `audit_anchors` table is a *convenience copy*, and it is important not to
 * mistake it for the control: whoever can truncate the trail can delete those
 * rows too. What it buys is automatic, cheap detection on every verification,
 * with no operator action. The published copy is what still answers when the
 * table is gone.
 */

/**
 * Where a published anchor is emitted. The service stays framework-free — every
 * other application service does — so the sink is injected rather than a logger
 * being imported here.
 */
export type AnchorSink = (line: string) => void;

/** The tag that makes anchors greppable in a log archive. */
export const ANCHOR_LOG_TAG = 'FIDES_AUDIT_ANCHOR';

/** The claim that gets signed: this chain stood at this position, at this time. */
export interface AuditAnchorClaim {
  readonly seq: number;
  readonly hash: string;
  readonly publishedAtMs: number;
  /**
   * The signing key id. Present in the signed payload as well as the envelope so
   * the claim is bound to its key: an attacker cannot take a valid signature and
   * re-present it as though a different key had made it.
   */
  readonly keyId: string;
}

export interface PublishedAnchor {
  readonly claim: AuditAnchorClaim;
  /** The exact canonical string that was signed. */
  readonly payload: string;
  readonly signature: string;
}

/**
 * What an anchor says about the trail as it stands now.
 *
 * `unanchored` is deliberately distinct from `intact`: no anchor may mean a
 * freshly-deployed system that has not published yet, or it may mean every
 * anchor row was deleted. Those cannot be told apart from inside the database,
 * which is exactly why the published copy exists — so this reports "no claim to
 * check" rather than implying safety.
 */
export type AuditTailStatus = 'intact' | 'truncated' | 'unanchored' | 'anchor_unverifiable';

export interface AuditTailVerification {
  readonly status: AuditTailStatus;
  /** Where the chain ends now; null when the trail is empty. */
  readonly headSeq: number | null;
  /** The highest position any surviving anchor attests to. */
  readonly anchoredSeq: number | null;
  readonly anchoredAt: Date | null;
  /** Set when an anchor was checked but did not verify, or contradicts the chain. */
  readonly detail: string | null;
}

/** The result of checking an anchor an operator supplied from the log archive. */
export interface ExternalAnchorVerification extends AuditTailVerification {
  /** False when the payload/signature pair is not genuine at all. */
  readonly signatureValid: boolean;
}

/** The canonical string that is signed, and that verification re-checks. */
export function anchorPayload(claim: AuditAnchorClaim): string {
  return stableStringify(claim);
}

/**
 * One log line per anchor. Compact and single-line by construction —
 * `stableStringify` emits no whitespace — so it survives every log pipeline and
 * splits unambiguously into tag, payload, and signature.
 */
export function formatAnchorLine(anchor: PublishedAnchor): string {
  return `${ANCHOR_LOG_TAG} ${anchor.payload} ${anchor.signature}`;
}

/** Parse a claim back out of a payload, rejecting anything malformed. */
export function parseAnchorPayload(payload: string): AuditAnchorClaim {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new ValidationError('Anchor payload is not valid JSON');
  }
  const claim = parsed as Partial<AuditAnchorClaim>;
  if (
    typeof claim?.seq !== 'number' ||
    !Number.isInteger(claim.seq) ||
    claim.seq < 0 ||
    typeof claim.hash !== 'string' ||
    typeof claim.publishedAtMs !== 'number' ||
    typeof claim.keyId !== 'string'
  ) {
    throw new ValidationError('Anchor payload is missing required fields');
  }
  return {
    seq: claim.seq,
    hash: claim.hash,
    publishedAtMs: claim.publishedAtMs,
    keyId: claim.keyId,
  };
}

export class AuditAnchorService {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
    private readonly clock: EventClock,
    private readonly signing: SigningPort,
    private readonly sink: AnchorSink,
  ) {}

  /**
   * Sign and publish the current head. Returns null when there is nothing new to
   * say — an empty trail, or a head already covered by the newest anchor.
   *
   * Skipping an unchanged head is safe: the existing anchor already pins that
   * position, and republishing it every interval would fill a log archive with
   * identical claims on an idle system.
   *
   * **Order matters.** The line is emitted *before* the row is stored, because
   * the line is the control and the row is convenience. If storing then fails,
   * the anchor is still published and the next pass simply republishes it.
   */
  async publish(): Promise<PublishedAnchor | null> {
    const head = await this.head();
    if (!head) return null;

    const [newest] = await this.db
      .select({ seq: auditAnchors.seq, hash: auditAnchors.hash })
      .from(auditAnchors)
      .orderBy(desc(auditAnchors.seq))
      .limit(1);
    if (newest && newest.seq === head.seq && newest.hash === head.hash) return null;

    const publishedAt = this.clock.now();
    const claim: AuditAnchorClaim = {
      seq: head.seq,
      hash: head.hash,
      publishedAtMs: publishedAt.getTime(),
      keyId: this.signing.primaryKeyId,
    };
    const payload = anchorPayload(claim);
    const anchor: PublishedAnchor = { claim, payload, signature: this.signing.sign(payload) };

    this.sink(formatAnchorLine(anchor));

    await this.db.insert(auditAnchors).values({
      id: this.ids.next(),
      seq: claim.seq,
      hash: claim.hash,
      publishedAt,
      payload,
      signature: anchor.signature,
    });

    return anchor;
  }

  /**
   * Check the chain against the highest-seq anchor that survives in the table.
   * This is the automatic, no-operator-action path, and it is the one an
   * attacker who deleted the anchors defeats — hence `unanchored`.
   */
  async verifyTail(): Promise<AuditTailVerification> {
    const [row] = await this.db
      .select()
      .from(auditAnchors)
      .orderBy(desc(auditAnchors.seq))
      .limit(1);
    if (!row) {
      return {
        status: 'unanchored',
        headSeq: (await this.head())?.seq ?? null,
        anchoredSeq: null,
        anchoredAt: null,
        detail: 'No anchor has been published, or every anchor has been removed',
      };
    }

    let claim: AuditAnchorClaim;
    try {
      claim = parseAnchorPayload(row.payload);
    } catch {
      return this.unverifiable(row.seq, row.publishedAt, 'Stored anchor payload is malformed');
    }
    if (!this.signing.verify(row.payload, row.signature)) {
      return this.unverifiable(row.seq, row.publishedAt, 'Stored anchor signature does not verify');
    }
    // The signed payload is authoritative; the columns exist for indexing. If
    // they disagree, someone edited the row and left the signature alone.
    if (claim.seq !== row.seq || claim.hash !== row.hash) {
      return this.unverifiable(
        row.seq,
        row.publishedAt,
        'Stored anchor columns contradict its signed payload',
      );
    }

    return this.compareAgainstChain(claim, row.publishedAt);
  }

  /**
   * Check the chain against an anchor an operator holds from the log archive —
   * the path that still works when the table has been emptied, and the reason
   * the signature is asymmetric.
   */
  async verifyAgainstAnchor(
    payload: string,
    signature: string,
  ): Promise<ExternalAnchorVerification> {
    const claim = parseAnchorPayload(payload);
    if (!this.signing.verify(payload, signature)) {
      return {
        signatureValid: false,
        status: 'anchor_unverifiable',
        headSeq: (await this.head())?.seq ?? null,
        anchoredSeq: claim.seq,
        anchoredAt: new Date(claim.publishedAtMs),
        detail: 'The supplied anchor is not a genuine signature over that payload',
      };
    }
    const compared = await this.compareAgainstChain(claim, new Date(claim.publishedAtMs));
    return { ...compared, signatureValid: true };
  }

  /**
   * The verdict, given a genuine claim: the chain must still reach the anchored
   * position, and still hold the anchored hash there.
   */
  private async compareAgainstChain(
    claim: AuditAnchorClaim,
    anchoredAt: Date,
  ): Promise<AuditTailVerification> {
    const head = await this.head();
    const base = { anchoredSeq: claim.seq, anchoredAt, headSeq: head?.seq ?? null };

    if (!head || head.seq < claim.seq) {
      // The trail is shorter than something already attested to. Nothing else
      // explains this: the chain only ever grows.
      return {
        ...base,
        status: 'truncated',
        detail: `The trail ends at ${head ? head.seq : 'nothing'} but was anchored at ${claim.seq}`,
      };
    }

    const [atAnchor] = await this.db
      .select({ hash: auditLog.hash })
      .from(auditLog)
      .where(eq(auditLog.seq, claim.seq))
      .limit(1);
    if (!atAnchor || atAnchor.hash !== claim.hash) {
      // The position survives but holds a different record: history was rewritten
      // beneath the anchor rather than cut from the end.
      return {
        ...base,
        status: 'truncated',
        detail: `The record at ${claim.seq} no longer matches the anchored hash`,
      };
    }

    return { ...base, status: 'intact', detail: null };
  }

  private async unverifiable(
    seq: number,
    at: Date,
    detail: string,
  ): Promise<AuditTailVerification> {
    return {
      status: 'anchor_unverifiable',
      headSeq: (await this.head())?.seq ?? null,
      anchoredSeq: seq,
      anchoredAt: at,
      detail,
    };
  }

  private async head(): Promise<{ seq: number; hash: string } | undefined> {
    const [head] = await this.db
      .select({ seq: auditLog.seq, hash: auditLog.hash })
      .from(auditLog)
      .orderBy(desc(auditLog.seq))
      .limit(1);
    return head;
  }
}
