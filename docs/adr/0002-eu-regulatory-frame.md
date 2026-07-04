# ADR-0002: EU/EEA regulatory frame (PSD2/SCA, GDPR, EMI semantics)

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer

## Context

The product targets EU/EEA natural persons with EUR accounts and SEPA payments. Even as a simulated, unlicensed core, the design should align with the frameworks a licensed deployment would inherit.

## Decision

Adopt the EU/EEA regulatory frame as a design constraint: **PSD2 Strong Customer Authentication** for login and sensitive operations (with dynamic linking for payments), **GDPR** data-protection posture (minimization, retention, data-subject rights, EU residency), and **e-money (EMI) semantics** for the account model. The platform remains explicitly unlicensed.

## Consequences

Positive:

- Security and data models are credible and future-proof for a licensed deployment.
- SCA and GDPR requirements shape identity, audit, and data handling from day one.

Trade-offs / negative:

- Additional control surface (SCA step-up, retention, consent) earlier than a toy app would need.

## Alternatives considered

- **Defer compliance shaping until licensing** — rejected: would require invasive rework of identity, audit, and data flows later.
