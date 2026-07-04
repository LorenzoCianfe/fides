# ADR-0017: ORM selection — Drizzle

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer
- Supersedes: the "Proposed" ORM decision recorded during discovery

## Context

The persistence layer sits under a correctness-critical double-entry ledger. It needs precise, inspectable SQL, strong TypeScript inference, and migration tooling the maintainer fully controls. The two finalists were Drizzle and Prisma.

## Decision

Use **Drizzle ORM** with the `postgres-js` driver and `drizzle-kit` for migrations. Drizzle is SQL-first with a thin runtime and exact type inference, keeping the ledger's queries explicit and close to real Postgres behavior; adapter contract tests run against actual SQL semantics.

## Consequences

Positive:

- Full control and visibility over ledger SQL and migrations; minimal runtime overhead.
- Excellent type inference without a heavy client or query abstraction.

Trade-offs / negative:

- Less batteries-included tooling than Prisma (e.g. Studio, generated client ergonomics).
- More hand-written SQL for complex queries — acceptable and desirable for a ledger.

## Alternatives considered

- **Prisma** — rejected: heavier runtime and more abstraction between the code and ledger SQL, despite very mature migration tooling and DX.
