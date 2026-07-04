# ADR-0005: PostgreSQL + append-only double-entry ledger + event/outbox

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer

## Context

Money movement must be correct, auditable, and reconcilable. Balances must never be silently mutated, and state changes must be integrable and projectable without distributed transactions.

## Decision

Use **PostgreSQL** as the system of record with an **append-only, double-entry ledger** (`ledger_accounts`, `journal_entries`, `postings`); every economic event is a balanced entry whose postings sum to zero per currency. Balances are derived read models. A **transactional outbox** captures domain events in the same transaction as the state change for auditability, projections, and integration.

## Consequences

Positive:

- Financial invariants are enforceable and testable; history is immutable.
- Outbox gives at-least-once event delivery without two-phase commit.

Trade-offs / negative:

- Derived balances require projection/caching logic and reconciliation.
- Append-only storage grows; retention and archival must be planned.

## Alternatives considered

- **Mutable balance columns** — rejected: unauditable and error-prone under concurrency.
- **Event sourcing everywhere** — rejected: heavier model than needed; outbox + ledger suffices.
