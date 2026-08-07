# ADR-0029: Per-account admin lockout, and auditing denied attempts

- Status: Accepted
- Date: 2026-08-06
- Deciders: Solo maintainer
- Refines: [ADR-0025](0025-admin-rbac-mfa-four-eyes.md), [ADR-0024](0024-append-only-hash-chained-audit-trail.md)

## Context

Two gaps recorded in `security.md` turn out to be one problem wearing two hats.

**Admin sign-in is throttled but not lockout-protected.** ADR-0025 bounds guessing with a per-IP route throttle: five attempts a minute on the password step, ten on the TOTP step. Against a six-digit code with a ±1-step window those odds are poor, and the ADR judged them acceptable. But a throttle is a rate limit, not a stop: it is per-IP and in-memory (ADR-0021), so it resets on restart and distributes trivially across addresses. An attacker with a known operator address and patience is not actually prevented from anything.

**Denied attempts are not audited.** ADR-0024 writes every audit record *inside its action's own transaction*, so no action can occur without its audit and no audit without its action. That invariant is why the trail is trustworthy — and it is exactly what a denial cannot satisfy. A denial has no committed action to be atomic with. Worse, `verifyMfa` deliberately **rolls its transaction back** on a wrong code, so the login challenge survives a typo rather than costing the operator the password step. Anything written inside that transaction is discarded with it. The result today is that a failed sign-in leaves no trace anywhere.

The two connect through that rollback. A lockout counter is a durable record of a failed attempt; so is an audit record of a denial. Both must survive the transaction that authentication deliberately throws away. Solving either means building the same escape hatch, so they are decided together and land in one change.

## Decision

**Lockout is per-account, counted across both factors.** `admins` gains `failed_login_attempts` and `locked_until`. A wrong password and a wrong TOTP code advance the same counter, because an attacker who is past the password step is further along, not safer — counting the factors separately would give the second factor its own fresh budget, which is backwards. At the threshold (default 5) the account locks for a fixed window (default 15 minutes), both configurable.

**The counter is written in its own transaction, immediately after the failure.** This is the documented exception to ADR-0024's atomicity rule, and it is an exception by necessity rather than convenience: there is no transaction to join, and the one that exists is deliberately rolled back. The same separate transaction writes the denial to the audit trail, so the record and the count cannot disagree.

**Recording never breaks the rejection.** The post-failure write is best-effort and swallows its own errors. Losing a denial record is bad; turning a rejected sign-in into a 500 would be worse — it fails the operator differently from a normal rejection, which is itself a signal that the attempt was interesting.

**Only a rejected *code* counts, not a rejected challenge.** A stale, expired, or already-consumed challenge token is not a guess at the second factor. Counting it would hand anyone holding a spent token a way to lock an operator out at will, converting a hardening control into a denial-of-service primitive.

**Lockout is cleared only when both factors have succeeded**, in the same statement that sets `last_login_at` inside `issueSession` — the single point where admin authentication actually completes. Clearing it at the password step would let an attacker who already has the password reset the counter at will and grind the second factor indefinitely, which is the precise scenario the control exists for.

**A locked account fails with the same generic `Invalid credentials`.** Saying "this account is locked" confirms the address exists and tells an attacker their guessing is having an effect — giving back the enumeration resistance ADR-0025 built the decoy-hash path to preserve.

**Denials are recorded only for a known admin.** An unknown address has no admin to reference, and the address itself is PII; ADR-0024 holds internal references only, never raw PII, because the trail is un-erasable and a GDPR erasure cannot reach it. Volume from unknown addresses stays the throttle's problem. This is a real limitation — a spray across many addresses leaves no trail — and it is accepted rather than solved by writing personal data into an immutable log.

**Reaching the threshold is audited separately** (`admin.locked`) from the denials that caused it (`admin.auth.denied`, carrying the factor and the running count), so the transition is greppable without reconstructing it from a sequence.

**The counter resets to zero when the lock is applied.** The lock is the penalty; carrying the count past it would re-lock on the first failure after expiry and make every subsequent lockout permanent in practice.

## Consequences

Positive:

- Online guessing against a known operator address is now stopped rather than slowed, and the guarantee no longer depends on in-memory, per-IP, restart-resettable state.
- Failed back-office authentication leaves a tamper-evident trail for the first time, on the same hash chain as everything else, so `verify()` covers it.
- The rollback that protects an operator's typo no longer also protects an attacker's guess — the property that made the TOTP step effectively uncounted.
- The escape hatch generalizes: any future control that must record something about a *denied* action now has a pattern and a precedent.

Trade-offs / negative:

- **Lockout is a denial-of-service vector against a named operator.** Anyone who knows an address can lock it for the window. This is inherent to per-account lockout and is why the window is short and configurable rather than a permanent lock needing an administrator; the `admins.manage` path exists if an operator must be recovered sooner. Bounded, not eliminated.
- Audit records are now written outside their action's transaction. The invariant ADR-0024 relies on still holds for every *action* — nothing succeeded without its record — but the trail no longer has a single uniform write path, and that is a subtlety a future reader must not misread as a bug.
- A denial write takes the chain's advisory lock, so failed sign-ins now contend for it. Bounded by the route throttle at a low rate, but it is contention that did not exist.
- Attempts against unknown addresses remain invisible to the trail, so the audit view of an attack is partial by construction.

## Alternatives considered

- **Exponential backoff per account instead of a fixed lockout** — rejected for now: it is gentler on the denial-of-service trade-off, but it needs per-attempt timing state and gives a weaker guarantee, and the fixed window is the control auditors expect to see. Worth revisiting if operator lockouts become a real nuisance.
- **Count the two factors separately** — rejected: it grants a fresh budget to an attacker who has already defeated the password, which inverts the intended difficulty.
- **Distinguish "account locked" in the error** — rejected: it is a better operator experience and a worse security posture, and it undoes ADR-0025's uniform-failure work. The lock is visible to the operator through their own support path, not through an unauthenticated endpoint.
- **Write denials on a second database connection outside any transaction** — rejected as no better: the separate transaction already achieves durability across the rollback, and a bare connection would lose the advisory lock the chain needs.
- **Hash the email and record denials for unknown addresses** — rejected: a hashed email is still personal data under GDPR when the input space is enumerable, and the trail cannot be erased. The throttle covers the volume case.
- **Defer denial auditing to a separate log outside the chain** — rejected: a denial record that is not tamper-evident is the one an insider would edit, so it belongs on the chain or nowhere.
- **Rely on the throttle alone, as ADR-0025 chose** — rejected on reflection: an in-memory, per-IP, per-instance counter that resets on restart is not the control the security model claims when it says back-office access is hardened.
