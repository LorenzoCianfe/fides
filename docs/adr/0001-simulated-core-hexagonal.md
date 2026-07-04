# ADR-0001: Simulated core with hexagonal ports/adapters (design-for-BaaS)

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer

## Context

The platform must be a credible, production-grade neobank without a banking licence or live financial rails. It must nonetheless be architected so a licensed Banking-as-a-Service (BaaS) provider can supply real rails later without reworking the domain.

## Decision

Build a **simulated core**: implement genuine domain logic and a real double-entry ledger, while every external capability (SEPA, card issuing, KYC/AML, market data, notifications) is expressed as a domain-facing **port** with a **mock adapter** today and a provider adapter later. The domain never depends on an external SDK directly.

## Consequences

Positive:

- Integration risk with real providers is isolated at the adapter boundary.
- The domain is fully testable offline; adapter contract tests pin provider semantics.
- "Design-for-BaaS" is a first-class constraint, not a retrofit.

Trade-offs / negative:

- Some upfront abstraction cost for capabilities that are mocked today.
- Mock/real divergence must be actively managed via contract tests.

## Alternatives considered

- **Direct integration with a BaaS now** — rejected: requires a provider relationship/licence and couples the domain to a vendor prematurely.
- **Pure prototype without a real ledger** — rejected: would not be credible or hardenable to production.
