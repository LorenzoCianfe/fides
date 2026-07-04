# ADR-0007: Passkeys-first, self-managed identity with step-up SCA

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer

## Context

Authentication must be phishing-resistant and PSD2-SCA-compliant, with full control over identity data and EU residency, avoiding third-party identity lock-in.

## Decision

Adopt **passkeys / WebAuthn** as the primary authentication method, with **device binding** on mobile and **step-up SCA** for high-risk actions (outbound payments, adding payees, security changes, limit raises, sensitive card actions). Identity is **self-managed** in the platform's own PostgreSQL.

## Consequences

Positive:

- Phishing-resistant possession+inherence auth; no third-party identity dependency.
- Full data control and EU residency; SCA dynamic linking designed in.

Trade-offs / negative:

- The platform owns credential lifecycle, recovery, and security operations.

## Alternatives considered

- **Third-party IdP (Auth0/Cognito)** — rejected: data-residency and lock-in concerns, less control over SCA semantics.
- **Passwords + TOTP** — rejected: weaker than passkeys and more phishing-prone.
