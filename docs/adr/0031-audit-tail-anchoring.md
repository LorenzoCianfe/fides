# ADR-0031: Audit tail anchoring by signed, published high-water marks

- Status: Accepted
- Date: 2026-08-07
- Deciders: Solo maintainer
- Refines: [ADR-0024](0024-append-only-hash-chained-audit-trail.md), [ADR-0028](0028-field-level-encryption-totp-secrets.md), [ADR-0001](0001-simulated-core-hexagonal.md)

## Context

ADR-0024 built a hash-chained audit trail and closed by naming its own limit:

> The chain detects any modification or removal of a **non-tail** record, but not
> deletion of the **tail** (truncation): dropping the most recent rows leaves a
> shorter-but-valid chain. Detecting truncation needs an external high-water
> anchor (a notarized latest `seq`/`hash`), deferred beyond Phase 1.

That deferral is the last correctness debt in the audit trail, and it is a
sharper hole than it first sounds. `verifyAuditChain` walks from genesis
checking three things: that each record's hash recomputes, that each links to
its predecessor, and that the sequence is gap-free. Delete the newest N records
and **all three still hold**. `verify()` answers `ok: true`, with a lower
`count` that nobody has a prior expectation about. The trail proves that what it
contains was not altered; it says nothing whatsoever about what it no longer
contains.

The threat is specific and it is the one an audit trail exists for: an insider,
or an attacker who has reached database credentials, doing something sensitive
and then erasing the record of having done it. Every other tamper is caught. This
one is invisible.

The reason the chain cannot close this itself is structural. Detection requires
knowing that the trail was *once longer*, and that knowledge cannot live only
where the trail lives — an attacker who can delete records can delete anything
stored beside them. So the question is not what to compute, but **where to put
it**, and how much of the trust boundary it has to leave.

## Decision

**A high-water anchor is published periodically: the chain head's `(seq, hash)`,
signed, emitted to the process log, and also stored in an `audit_anchors` table.**

**The published log line is the control. The table is convenience.** This
distinction is load-bearing and is stated in the code, the schema comment, and
the API description, because getting it backwards would produce a system that
looks anchored and is not. Whoever can truncate `audit_log` can delete the
anchor rows in the same transaction. What survives them is the copy that already
left the host through ordinary log shipping — an attacker cannot unpublish a
line that has been forwarded, archived, or read. The table buys automatic,
zero-effort detection on every `verify()` call, which is worth having and is not
the guarantee.

**Signing is Ed25519 through a `SigningPort`, not an HMAC.** An HMAC would be
simpler and would reuse the ADR-0028 keyring almost verbatim, but anyone who can
verify an HMAC can forge one, which forces every verifier inside the trust
boundary of the signer. That defeats the purpose: the whole point of an anchor
is to be checkable by someone who has stopped trusting this system. Asymmetric
signing lets an auditor — or the operator, reading a log archive months later —
confirm an anchor while holding nothing that could mint a false one. The public
key is logged at startup so it can be pinned out of band.

**The port is shaped exactly like `EncryptionPort` (ADR-0001, ADR-0028):** a
keyring addressed by id, a self-describing `fsig$v1$keyId$signature` envelope
naming the key that made it, and an adapter a KMS or HSM can replace without
touching a caller. Signing is precisely the operation one would eventually want
in an HSM, so the seam is worth having on the first day. Rotation is therefore
configuration rather than a migration: the primary signs, every key in the ring
still verifies, so anchors published under a retired key stay checkable.

**`AUDIT_ANCHOR_KEYS` is required with no default,** matching `ENCRYPTION_KEYS`
and for a sharper version of the same reason. A default would be a published
key, and a published signing key lets *anyone* mint an anchor for a truncated
chain — worse than having none. The other tempting option, making it optional so
the system boots without anchoring, is the silent downgrade `security.md` tenet 6
forbids: it would appear to anchor and would not.

**The key id is inside the signed payload as well as the envelope,** so a valid
signature cannot be re-presented as though a different key had made it.

**A pass that finds an unchanged head publishes nothing.** The existing anchor
already pins that position, and republishing an identical claim every interval
would fill a log archive with noise on an idle system.

**The line is emitted before the row is stored.** If storing then fails, the
anchor is still published — the control succeeded and the convenience did not,
which is the right way round. The next pass simply republishes.

**Verification reports the chain and the tail separately, and `ok` is their
conjunction.** They answer different questions and neither subsumes the other.
The chain walk catches edits and removals *within* the trail; the anchor
comparison catches the trail being cut short, or history rewritten beneath an
anchored position.

**`unanchored` is a distinct status, and it is not a failure.** No surviving
anchor means either a freshly-deployed system that has not published yet, or one
whose anchors were all deleted. **Those are indistinguishable from inside the
database** — which is the argument for the published copy in miniature — so the
API reports "no claim was checked" rather than implying either safety or alarm.
Collapsing it into `ok: false` would cry wolf on every fresh deployment and train
operators to ignore the field.

**`POST /v1/admin/audit/verify-anchor` checks the trail against an anchor the
caller supplies,** behind the existing `audit.read`. This is the path that still
answers when the table has been emptied alongside the records it attested to,
and it is the reason the signature is asymmetric. A POST because the anchor is a
payload rather than an identifier and must not enter a URL, an access log, or a
browser history — the same reasoning that keeps the web client's enrolment token
out of a query string. It mutates nothing.

**The anchors table carries the ledger's `fides_forbid_mutation` trigger.** Not
because it makes the table the control — it does not — but because it raises
tampering from a single `UPDATE` to a schema change, which is the same floor the
audit trail itself has.

**Anchors are deliberately not chained to one another.** Each is an independent
signed claim, verifiable alone. Chaining them would mean losing every later
anchor when an early one was deleted, which is exactly backwards here.

**Publication runs on the existing `OperationsScheduler`**, overlap-guarded like
the other passes, at `AUDIT_ANCHOR_INTERVAL_MS` (default five minutes). Reading
the head takes no advisory lock — an uncommitted append is invisible to it
anyway — so anchoring adds **no contention to the money path**, which matters
given the trouble ADR-0024 took to acquire the chain lock last. A failed pass is
logged at error rather than warning: a publisher that has quietly stopped leaves
the trail unanchored, which is a security event and not noise.

## Consequences

Positive:

- The last gap ADR-0024 named is closed. Truncation is now detectable, and the
  detection does not depend on the database the trail lives in.
- Verification tells an operator *which* kind of tampering it found: a broken
  link is a rewrite, a short chain is a deletion. Those need different responses.
- The `SigningPort` generalizes. Anything later needing a claim checkable outside
  this system — an export manifest, a regulatory attestation, a reconciliation
  statement — now has a port, an adapter, and a rotation story.
- The guarantee costs nothing on the request path: no new lock, no new work
  inside any transaction, and a background pass whose failure cannot affect a
  customer or an operator action.

Trade-offs / negative:

- **This defends against database access, not against a host that also holds the
  signing key.** Someone who owns the application host can mint anchors for a
  truncated chain. What they cannot do is retract the anchors already shipped, so
  detection degrades from automatic to "compare against your log archive" rather
  than disappearing. This is the same boundary ADR-0028 drew for encryption, and
  it moves only when the key moves into a KMS or HSM — which the port now allows.
- **The truncation window is the publish interval.** Records appended since the
  last anchor can still be deleted undetectably. Five minutes is a policy choice,
  not a performance one, and the setting is documented as such.
- The guarantee depends on log retention, which is now a security control rather
  than an operational convenience. A deployment that discards logs after a day
  has an anchor whose value expires with them.
- `unanchored` is a state operators must learn to read. It is honest and it is
  not "fine", and no amount of naming fixes that it is genuinely ambiguous.
- One more required environment variable, with the same deployment friction
  `ENCRYPTION_KEYS` introduced: every place that boots the API needs it.

## Alternatives considered

- **A second table in the same database** — rejected as the load-bearing
  mechanism: it is defeated by exactly the access the threat model assumes, since
  one `DELETE` reaches both. It survives here only in its honest role, as the
  convenience copy, clearly labelled.
- **An append-only file sidecar on the host** — rejected. Cheaper than logging
  and it looks external, but it is per-instance, lost when a container is
  replaced, and reachable by any host-level attacker. It defends a narrower
  threat than its shape suggests, which is the worst property a control can have.
- **A third-party notary or public timestamping service** — the strongest option,
  and rejected for Phase 1: it adds an external dependency and a network failure
  mode to a control that must not fail quietly, in a system whose external rails
  are all deliberately mocked. The `SigningPort` plus the published line is the
  same shape, so adopting one later replaces an adapter rather than a design.
- **HMAC instead of Ed25519** — rejected: verification would require the forging
  key, so no one outside the system could check an anchor. That is the property
  being bought.
- **Anchor on every append rather than on an interval** — rejected: it would put
  a signature on the money path's transaction for a guarantee that is inherently
  periodic, and it would produce one log line per audited action.
- **Store a monotonic counter and check it never decreases** — rejected as
  security theatre: the counter lives in the same database and moves with the
  same `DELETE`.
- **Treat `unanchored` as a verification failure** — rejected: it is true of
  every system that has not yet published, so it would be false alarm by default,
  and an alarm that is usually wrong is not an alarm.
- **Make `AUDIT_ANCHOR_KEYS` optional and skip anchoring when unset** — rejected
  for the ADR-0028 reason: a system that appears to have a control and does not
  is worse than one that plainly lacks it.
