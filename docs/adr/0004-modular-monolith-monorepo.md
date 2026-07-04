# ADR-0004: Modular monolith in a pnpm/Turborepo monorepo

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer

## Context

The system spans a backend and three clients that share domain types, contracts, and design tokens. A solo maintainer needs fast, coordinated builds and strong internal boundaries without premature distributed-systems overhead.

## Decision

Ship a **modular monolith**: a single deployable backend decomposed into strict domain modules with explicit boundaries, inside a **pnpm workspaces + Turborepo** monorepo. Extraction into services remains possible later but is not adopted prematurely.

## Consequences

Positive:

- One repo, shared packages (`domain`, `contracts`, `ui-tokens`), cached task graph.
- Module boundaries give the option value of later service extraction.

Trade-offs / negative:

- A single deployable can become a scaling bottleneck if boundaries erode; discipline required.

## Alternatives considered

- **Microservices from the start** — rejected: operational overhead unjustified for a solo, pre-scale build.
- **Polyrepo** — rejected: fragments shared contracts and slows coordinated change.
