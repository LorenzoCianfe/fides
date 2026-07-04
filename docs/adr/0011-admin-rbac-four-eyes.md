# ADR-0011: Admin RBAC with segregation of duties and four-eyes

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer

## Context

Back-office operators hold powerful capabilities (account suspension, reversals, limit overrides, KYC overrides). Insider risk and repudiation must be controlled.

## Decision

Enforce **granular RBAC** (super-admin, compliance/AML officer, fraud analyst, support agent, read-only auditor), **segregation of duties** (no role both initiates and approves a sensitive action), and **four-eyes (maker-checker)** on high-risk operations. Admin access requires mandatory MFA and shorter sessions; a "view-as-customer" assist mode is explicit, time-boxed, and audited.

## Consequences

Positive:

- Insider risk and repudiation are structurally mitigated; every sensitive action is attributable.
- Assist mode is controlled and logged.

Trade-offs / negative:

- Four-eyes adds operational latency requiring a second operator.

## Alternatives considered

- **Single admin role** — rejected: no segregation of duties, unacceptable insider risk.
- **Ad hoc approvals** — rejected: not auditable or enforceable.
