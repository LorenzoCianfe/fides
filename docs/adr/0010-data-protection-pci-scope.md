# ADR-0010: Full data-protection posture; minimized PCI scope

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer

## Context

The platform handles PII and (simulated) cards. It must protect data to production standards while avoiding unnecessary PCI-DSS scope.

## Decision

Apply a **full data-protection posture**: encryption in transit and at rest, **field-level encryption/tokenization** for sensitive PII, **envelope encryption via a KMS abstraction** with rotation, and secrets in a dedicated manager. Because cards/PANs are **simulated**, no real PANs are stored, processed, or transmitted, **minimizing PCI-DSS scope** by design; a future real card program would route PANs to a PCI-compliant issuer/processor.

## Consequences

Positive:

- Strong PII protection; PCI scope kept minimal and explicit.
- KMS abstraction makes a later managed-KMS swap straightforward.

Trade-offs / negative:

- Field-level encryption adds access-path complexity for sensitive data.

## Alternatives considered

- **Handle real PANs in-platform** — rejected: pulls the whole system into PCI-DSS scope needlessly.
- **Application-managed keys in code/images** — rejected: violates least privilege and rotation requirements.
