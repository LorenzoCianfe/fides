# ADR-0014: Ledger-focused testing strategy (Vitest)

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer

## Context

Correctness of money math and invariants is the highest-value property. The test tooling should be uniform across backend and frontend to avoid divergence for a solo maintainer.

## Decision

Standardize on **Vitest** across the whole monorepo (backend, packages, and web). Prioritize **ledger-focused testing**: unit tests for the `Money` value object and rounding, invariant tests for balanced postings, integration tests for money paths, and **adapter contract tests** pinning provider semantics. No phase is complete while money-path or invariant tests fail.

## Consequences

Positive:

- One fast runner across all tiers; native TS/ESM, strong watch mode.
- Correctness is gated, not assumed.

Trade-offs / negative:

- NestJS runs under Vitest via a small esbuild decorator configuration rather than the default Jest setup.

## Alternatives considered

- **Jest** — rejected: slower, ESM-awkward, and divergent from the Vite-based frontend toolchain.
