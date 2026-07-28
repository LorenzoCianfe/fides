# ADR-0021: HTTP auth surface — token transport, SCA dynamic linking, throttling, and retention

- Status: Accepted
- Date: 2026-07-06
- Deciders: Solo maintainer
- Refines: [ADR-0007](0007-passkeys-self-managed-identity.md), [ADR-0020](0020-session-tokens-webauthn-policy.md)

## Context

Phase 1 Slice 3 Wave C exposes the headless identity services over HTTP (`/v1/auth`). Several choices that shape the public contract and its abuse-resistance were still open: how session tokens travel between client and server, how PSD2 dynamic linking is realized ahead of the transfer slice, the enumeration posture of the email flows, how the unauthenticated surface is rate limited, and what happens to dead security rows. These are pinned here as implemented; the platform-level HTTP policy (versioning, correlation, CORS) is recorded alongside them.

## Decision

**Token transport.** Session tokens travel in JSON response bodies for web and mobile alike; authenticated requests present the opaque access token as `Authorization: Bearer`. No cookies are set in Phase 1, so the CSRF surface is nil and the contract stays uniform across clients. An httpOnly-cookie mode for the web client (with CSRF defence and credentialed CORS) is deliberately deferred to Slice 8, when that client exists to exercise it; until then the XSS exposure of a browser-held refresh token is an accepted, documented gap.

**SCA step-up with dynamic linking.** A third WebAuthn ceremony type `sca` reuses the challenge machinery of ADR-0020. The action being authorized (`{type, payload}`) is canonicalized — recursively key-sorted JSON — and its SHA-256 stored on the challenge row (`action_hash`), so the options a client signs are bound to exactly one action. Verifying the fresh, user-verification-required assertion mints a **single-use SCA grant** (`fsg_…`, 256-bit, hashed at rest, 5-minute TTL) bound to the user, the issuing session, and the action hash. The guarded operation recomputes the hash and consumes the grant atomically inside its own transaction (`consumeScaGrant`), which is how the Slice 5 transfer will enforce PSD2 dynamic linking. A tampered amount or payee changes the hash and the ceremony or consumption fails with the generic authentication error.

**Email flows and enumeration.** `verify-email` and the new `resend-verification` are keyed by email, so onboarding can resume on any device; successful verification returns the `userId` and a fresh enrolment token (the re-issue path for tokens that expire before the first passkey). Failures are uniform — unknown email, missing code, expired code, and wrong code are indistinguishable — and resend always answers 202, acting only for passkey-less users. Registration keeps its explicit 409 on duplicate emails: the usability of an honest signup error outweighs the residual enumeration channel, which throttling blunts.

**Rate limiting.** `@nestjs/throttler` with in-memory storage, module-scoped to the auth surface, per-IP: register 5/min, resend-verification 3/min, refresh 30/min, all other auth routes 10/min. A root-level `skipIf` honors the `THROTTLE_ENABLED` kill-switch on every route, including those with per-route overrides. In-memory counters are correct for the single-instance Phase 1 topology; the storage adapter seam allows Redis later without contract changes. Throttled responses render the canonical envelope (`RATE_LIMITED`, 429).

**Retention and cleanup.** A scheduled sweeper deletes consumed or expired one-time secrets promptly — WebAuthn challenges, enrolment tokens, email verifications, and SCA grants are hashed rows with no audit value. Dead sessions (revoked, past their idle deadline, or past their absolute deadline) are retained for **90 days** as forensic evidence until the Slice 6 hash-chained audit trail exists, then deleted. SCA grants are swept before sessions: they reference session rows, and their 5-minute TTL guarantees any grant of a 90-day-dead session is itself long dead.

**Operational scheduling.** The outbox dispatcher and the sweeper run on env-tunable intervals (`OUTBOX_DISPATCH_INTERVAL_MS`, `CLEANUP_INTERVAL_MS`) behind a `SCHEDULERS_ENABLED` kill-switch, with overlap guards and logged (never swallowed) failures. The dispatcher only claims event types with a registered handler: unhandled types such as `kyc.approved` stay `pending` for the slice that will consume them (account provisioning, Slice 4) instead of being marked dispatched without effect.

**Platform HTTP policy.** All routes live under `/v1` except the unversioned `/health` liveness probe and the generated OpenAPI document at `/docs`. Every request carries a correlation id: a well-formed inbound `X-Correlation-Id` (8–128 URL-safe characters) is honored, anything else replaced with a UUID v7, echoed on the response, and injected into the error envelope. CORS is restricted to the client origins (`CORS_ORIGINS`, defaulting to `WEBAUTHN_ORIGINS`). `DATABASE_URL` is required at boot — the API is stateful from this wave on — and the connection pool closes on shutdown.

## Consequences

Positive:

- The transfer slice inherits a complete, tested SCA enforcement primitive: one `consumeScaGrant` call inside the posting transaction yields exactly-once, action-bound step-up.
- The onboarding funnel is recoverable end to end (lost enrolment tokens no longer strand users) without weakening the anti-enumeration stance of ADR-0020.
- Uniform contracts for web and mobile in Slice 8; no cookie/CSRF machinery to build before a browser client exists.
- Storage stays bounded and GDPR-minimal while preserving a forensic window for session incidents.

Trade-offs / negative:

- Browser storage of tokens is less robust against XSS than httpOnly cookies until the Slice 8 cookie mode lands.
- In-memory throttle counters reset on restart and do not aggregate across instances; acceptable at Phase 1 scale, revisit with horizontal scaling.
- The registration 409 remains a deliberate, throttled enumeration channel.
- Two-step SCA (options + verify) costs one extra round-trip versus sending assertions inline with the action; in exchange, payments never touch WebAuthn.

## Alternatives considered

- **httpOnly-cookie refresh tokens now** — rejected for this wave: builds CSRF defence, cookie scoping, and credentialed CORS with no web client to exercise them; revisit in Slice 8.
- **Assertion travels inline with the guarded action** — rejected: couples the payments module to WebAuthn verification and complicates idempotent retries; the single-use grant is replay-safe by construction.
- **Stateless (signed) SCA grants** — rejected: claims-in-token break immediate revocation exactly as JWTs would (ADR-0020); a DB row costs one indexed read.
- **Redis-backed throttling now** — rejected: first Redis dependency for a single-instance deployment; the Postgres-first stance holds and the throttler storage seam keeps the door open.
- **Purge sessions immediately (strict minimization)** — rejected until Slice 6: refresh-reuse and revocation records are the only forensic trail for account-takeover investigation today.
- **Marking unhandled outbox events dispatched** (previous behaviour) — rejected: it would silently consume `kyc.approved` before Slice 4 exists to act on it.
