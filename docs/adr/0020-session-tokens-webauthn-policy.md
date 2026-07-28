# ADR-0020: Opaque server-side session tokens and WebAuthn ceremony policy

- Status: Accepted
- Date: 2026-07-06
- Deciders: Solo maintainer
- Refines: [ADR-0007](0007-passkeys-self-managed-identity.md)

## Context

ADR-0007 committed to passkeys-first, self-managed identity with step-up SCA, but left the relying-party and session semantics open: token format and lifetimes, rotation behaviour, where WebAuthn challenges live between the two ceremony halves, how the very first passkey enrolment is authorized when no session exists yet, and how login behaves for unknown emails. These choices are security-relevant and hard to change once clients depend on them, so they are pinned here as implemented in Phase 1 Slice 3 Wave B.

## Decision

**Sessions.** Sessions are server-side rows in Postgres. The access and refresh tokens are opaque 256-bit random values (prefixed `fat_`/`frt_` for debuggability) stored only as SHA-256 hashes; there are no JWTs. Every authenticated request resolves the access token against the session row joined to the user, so revocation and account suspension take effect on the next request. Lifetimes: access token 15 minutes; refresh token rotating with a 30-day idle window; 90-day absolute cap — all env-overridable (`SESSION_*_TTL_MS`), with every extension clamped to the absolute deadline.

**Rotation and reuse detection.** Each refresh rotates both tokens and retains the superseded refresh hash. Presenting a superseded refresh token is treated as the stolen-token signal: the whole session is revoked (`refresh_token_reuse`), and the revocation is committed before the failure is raised so a rolled-back transaction cannot undo it.

**WebAuthn ceremonies.** User verification is `required` on registration and authentication, making every assertion two independent factors (possession + inherence/knowledge) for PSD2-SCA realism. Attestation is `none`; accepted algorithms are ES256 and RS256; `residentKey: preferred`. Login is email-first (options carry the user's `allowCredentials`); usernameless login can be added later without re-enrolment. Signature-counter regression is rejected as a clone signal.

**Challenges.** Challenges are single-use Postgres rows with a 5-minute TTL, storing only the SHA-256 of the issued challenge: a presented challenge is genuine iff its hash matches an unconsumed, unexpired row of the right ceremony type. Consumption is atomic and happens regardless of the verification outcome.

**Anti-enumeration.** An unknown email (or a user without passkeys) receives decoy authentication options — a genuine stored challenge bound to no user and a plausible credential list — and any assertion against them fails with the same generic error as a bad login, so the login surface cannot confirm which emails hold accounts.

**First-passkey enrolment.** Email verification issues a one-time enrolment token (15-minute TTL, hashed at rest) which the first passkey registration must consume — proof of email control replaces the session that does not exist yet. Completing that first ceremony auto-issues a session, so onboarding ends inside the app without a redundant second prompt. Additional passkeys require an authenticated session, and existing credentials are excluded from re-registration.

**Devices.** Sessions reference a device row matched-or-created at issue from client-declared metadata (name, platform). The metadata is honest-but-untrusted until mobile device attestation (Slice 8) strengthens it; it exists so session lists are recognisable and revocable per device.

## Consequences

Positive:

- Immediate, server-authoritative revocation; no token remains valid after logout, reuse detection, or suspension.
- Phishing-resistant two-factor sessions from day one; login cannot be used to enumerate accounts.
- Everything is testable headlessly: challenges, tokens, and sessions are plain rows, exercised by integration tests with a software authenticator producing real attestations and assertions.

Trade-offs / negative:

- Every authenticated request costs one indexed DB read (session join user). Acceptable now; a Redis fast-path is a later optimization that must preserve immediate revocation.
- Opaque tokens carry no claims, so any claim (roles, scopes) requires the DB row — intentional, since claims cached in a token are what breaks immediate revocation.
- The enrolment token adds one moving part to onboarding; a re-issue path (resend verification) is needed for tokens that expire before enrolment completes (Wave C).

## Alternatives considered

- **JWT access tokens** — rejected: stateless validation defeats immediate revocation and instant suspension; a denylist reintroduces the DB read while adding key management.
- **In-memory or Redis challenge storage** — rejected for now: in-memory breaks on restart and with multiple instances; Redis is not yet wired anywhere and would expand Wave B scope (consistent with the Postgres-first stance, ADR-0012 era defaults).
- **Usernameless (discoverable-only) login** — rejected as the first flow: no `allowCredentials` means no decoy strategy, and some authenticators refuse resident keys; kept open via `residentKey: preferred`.
- **Verified-email-only gating for the first passkey (no token)** — rejected: the userId would become a bearer secret; anyone learning it could bind a passkey to the account.
