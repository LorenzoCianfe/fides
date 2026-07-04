# ADR-0008: Full simulated KYC/AML onboarding pipeline

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer

## Context

Onboarding must be realistic and operable so that real KYC/AML providers can plug in later without redesign.

## Decision

Model the onboarding pipeline **end to end behind mock adapters**: identity data capture, document capture, a liveness/selfie step, sanctions/PEP screening (`ScreeningPort`), risk scoring, and a decision (approve / review / reject) with borderline cases escalating to the admin case queue. Ongoing screening hooks are reserved for periodic re-checks.

## Consequences

Positive:

- The full compliance flow exists and is operable; providers swap in at the port.
- Case escalation and decisioning are exercised from day one.

Trade-offs / negative:

- Mock decisioning must be scripted realistically to be useful.

## Alternatives considered

- **Stub onboarding as a single "verified" flag** — rejected: would not model the real operational flow or case handling.
