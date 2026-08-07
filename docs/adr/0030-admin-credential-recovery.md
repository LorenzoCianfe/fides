# ADR-0030: Admin credential rotation and four-eyes second-factor reset

- Status: Accepted
- Date: 2026-08-07
- Deciders: Solo maintainer
- Refines: [ADR-0025](0025-admin-rbac-mfa-four-eyes.md), [ADR-0029](0029-admin-login-lockout-denied-attempt-audit.md), [ADR-0011](0011-admin-rbac-four-eyes.md)

## Context

ADR-0025 gave the back office two credentials and no way to change either of
them. An operator could enrol a second factor exactly once, at first login, and
from that moment the only recovery path for a lost authenticator or a suspected
password compromise ran through a direct `UPDATE` on the `admins` table — which
is precisely the kind of unaudited, unilateral, out-of-band intervention the
whole slice exists to make unnecessary. `security.md` recorded it as the first
gap to close if the back office grew beyond one operator, and the workaround on
offer was for a `super_admin` to disable the account and create a new one, which
discards the operator's identity and every audit reference to it.

Three things are missing, and they are not equally shaped.

**Rotation is self-service.** Changing your own password is something an
operator does routinely and does not need permission to do. It is also the lever
they reach for when they suspect compromise, which makes it a *containment*
action rather than a maintenance one.

**A second-factor reset is not self-service, and cannot be.** The whole value of
the second factor is that losing the password does not lose the account. Any
mechanism that clears the factor on one operator's say-so hands that value
straight back: whoever performs the reset controls who enrols next. It is
therefore in the same class as admin funding — high-risk, and inherently
requiring a second pair of eyes.

**Adding a second four-eyes action breaks the generic decision route.** ADR-0025
put a deliberately generic `pending_admin_actions` table behind a single
registered type, and routed both decisions through
`POST /v1/admin/pending-actions/{id}/approve` under `admin_funding.approve`. With
two types the permission a decision needs depends on the *row*, which a
route-level `@RequirePermission` cannot know. That is a design question, not a
detail: the alternative is moving the decisive authorization check off the route.

## Decision

### Self-service password change

**`POST /v1/admin/me/password`, authenticated, behind no permission.** Rotating
your own credential is not a capability the role matrix grants or withholds, and
gating it would mean some role could be barred from changing a password it is
required to keep secret. It sits beside `GET /v1/admin/me` for that reason.

**Both factors are re-proven: the current password and a fresh TOTP code.** The
session alone must never be enough — a stolen session would otherwise become
permanent account takeover, which is the one outcome a second factor exists to
prevent. The current password alone is also not enough, because it is the thing
being replaced and an attacker who has it has everything except the factor.

**The code advances the same replay guard sign-in advances.** A code spent here
must be unusable at the login step, so `last_totp_step` moves exactly as it does
in `verifyMfa`. The consequence is deliberate and visible to operators: a code
just used to sign in will be rejected, and the next 30-second step must be
awaited. That is the price of a strict replay guard, and the alternative — a
second, independent guard for this route — would leave each one blind to codes
spent through the other.

**A successful change revokes every *other* session the admin holds.** A
password change that leaves the attacker's session alive is not containment. The
calling session is spared so routine rotation is not also a sign-out.

**Failures count against the ADR-0029 lockout, and are audited as denials**
carrying `operation: password_change` so a rotation failure is not misread as a
failed sign-in. An authenticated route that verifies a credential is a
credential-guessing surface, and leaving it uncounted would give a session
thief an unbounded oracle against the very password the second factor protects.
The route is throttled for the same reason the login routes are.

**Success clears the lockout counter.** ADR-0029 permits clearing only where
both factors have succeeded; this is the second such place, and the rule is
unchanged rather than widened.

**The new password must differ from the current one and meet the same
twelve-character minimum.** No password history is kept: one previous value is
what a reuse check can honestly enforce without storing old credentials, and
storing them to enforce more would be worse than the problem.

### Four-eyes second-factor reset

**`admin_totp_reset` becomes the second registered `pending_admin_actions`
type.** The table was built generic for exactly this, and needs no migration: the
type is a text discriminator and the reset clears columns that already exist.

**A new segregated pair, `admin_totp_reset.request` / `.approve`**, added to
`SEGREGATED_PERMISSION_PAIRS` so the matrix-wide invariant test covers it
automatically. `super_admin` approves and is denied the maker half, mirroring
funding.

**The maker half is narrower than funding's.** Only `compliance_officer` may
raise a reset, where `compliance_officer` *and* `support_agent` may raise a
funding request. Funding credits a customer within a configured cap; a reset
hands over a back-office identity, so it does not belong to front-line support.

**Approval clears the secret, the enrolment marker, the replay guard, and the
lockout — and revokes all of the target's sessions.** Each for its own reason.
The enrolment marker, because `beginMfaEnrolment` refuses an already-enrolled
admin and the row must look unenrolled for recovery to work at all. The replay
guard, because a stale step from the old secret would reject codes minted from
the new one until wall-clock time caught up. The lockout, because an operator
whose authenticator is gone has usually been failing the second factor into a
lock, and recovering the credential while leaving the lock set would still deny
the login. The sessions, because a factor being reset may be a factor in the
wrong hands.

**No admin may approve a reset of their own second factor.** `checkerId !=
makerId` is about who *decides*; it says nothing about the *target*. Approving
your own reset is a unilateral second-factor bypass — the precise outcome the
control exists to prevent — so it is an authorization failure, checked under the
row lock alongside the other approval rules.

**The reset carries no `Idempotency-Key`.** Funding's approval needs one because
it posts through the ledger's idempotency machinery; a reset has no second
effect to guard against, and the `status = pending` check under `FOR UPDATE` is
the whole concurrency story. A retry after a lost response receives a 400 naming
the current status, from which the checker can see the reset already succeeded.

### Type-scoped decision routes

**Decisions move to type-scoped routes** — `/v1/admin/funding-requests/{id}/
approve|reject` and `/v1/admin/totp-resets/{id}/approve|reject` — while
`/v1/admin/pending-actions` remains the unified, type-agnostic *read*. Each
decision route carries its own `@RequirePermission`, so who may approve what
stays visible in the diff that grants it.

**Every decision asserts the row's type under the lock**, so pointing one type's
route at the other's id fails there as well as at the guard. This matters because
`super_admin` holds both checker halves: the guard alone would let it through.

## Consequences

Positive:

- A lost authenticator and a suspected password compromise both have a recovery
  path that is authorized, audited, and — for the reset — impossible for one
  person to perform alone. Neither needs database access any more.
- The generic four-eyes table stops being generic in theory only. The second
  type arrived without a migration, which is the payoff ADR-0025 predicted.
- Session revocation makes a credential change a containment lever rather than a
  bookkeeping one, on both paths.
- The disable-and-recreate workaround is no longer the answer to a lost factor,
  so operator identities and their audit references survive recovery.

Trade-offs / negative:

- **A reset needs a live checker.** A deployment with a single `super_admin` who
  loses their authenticator has no path, because no one else may approve and they
  cannot approve their own. Staffing at least two `super_admin` accounts is now
  an operational requirement, not a preference.
- **Two colluding operators can take over a third's account.** A
  `compliance_officer` and a `super_admin` together can reset any operator's
  factor and then control who enrols. This is inherent to four-eyes recovery —
  the control bounds unilateral action, not collusion — and what remains is the
  tamper-evident trail naming both of them.
- The shared replay guard makes a rotation immediately after a sign-in wait for
  the next time step. Correct, and mildly irritating.
- Counting rotation failures toward lockout means a session thief who guesses the
  password wrongly can lock the legitimate operator out. This is the ADR-0029
  denial-of-service residual reappearing on a new surface rather than a new one,
  and it is bounded by the same short window.
- The four-eyes HTTP surface is wider: two decision routes per type instead of
  one shared pair. Adding a Phase 2/3 type now means adding routes, not only a
  payload — a deliberate trade of terseness for legible authorization.

## Alternatives considered

- **Keep one generic decision route and resolve the permission inside the
  service** — rejected. It is less HTTP surface and it works, but it moves the
  decisive authorization check out of the route annotation and into a service
  method, where a reviewer reading the controller can no longer see who may
  approve what. On the one surface whose entire purpose is authorization, that is
  the wrong direction.
- **An admin-initiated password *reset*, behind four-eyes** — rejected for now,
  and this is the largest thing left undone. There is no out-of-band delivery
  channel for admins in Phase 1, so a reset would have to mint a temporary
  password and hand it to the approving checker, who would then hold a working
  credential for another operator until it was changed. That is the opposite of
  what four-eyes buys. A forgotten password therefore still ends at the
  `super_admin` disable-and-recreate path. Revisit when the back office has a
  notification channel of its own, or when WebAuthn replaces the admin password.
- **Reset the factor by disabling and re-creating the account** — the status quo,
  rejected: it destroys the operator's identity, orphans every audit record that
  references it, and is a `super_admin` acting alone on the account of someone
  who cannot object.
- **Let the target self-serve a reset from a live session** — rejected: an
  operator with a live session and a working password can already re-enrol
  nothing, and permitting it would mean a stolen session plus a stolen password
  clears the second factor, which is exactly the bypass being prevented.
- **A separate replay guard for the password-change code** — rejected: two
  guards, each blind to codes the other has spent, is strictly weaker than one.
- **Require four-eyes for the password change too** — rejected as absurd for a
  self-service rotation, and actively harmful: it would make the containment
  lever unavailable at the moment an operator most needs it.
- **Keep a password history to forbid reuse of the last N** — rejected: it means
  retaining superseded credential hashes for a marginal control. Rejecting only
  the current password is what can be enforced without storing anything extra.
- **Give `super_admin` the reset maker half as well, so it can self-serve when
  it is the only operator** — rejected: it collapses the segregated pair and
  makes the structural invariant false, to work around a staffing problem whose
  real fix is a second operator.
