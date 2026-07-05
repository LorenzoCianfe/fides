# ADR-0019: Synchronous in-transaction balance projection

- Status: Accepted
- Date: 2026-07-05
- Deciders: Solo maintainer
- Refines: [ADR-0005](0005-postgres-double-entry-ledger.md)

## Context

ADR-0005 established an append-only double-entry ledger where balances are derived read models projected from events. In practice a money-moving operation must check available funds before it commits, and that check has to read an authoritative, immediately-consistent balance under a lock. A balance projected asynchronously from the outbox cannot safely gate spending: it may be stale at decision time, admitting double-spend. This ADR pins how the balance projection is maintained.

## Decision

The `balances` table is a projection maintained **synchronously, in the same database transaction as the postings that change it**, guarded by a row lock (`SELECT … FOR UPDATE`), and is **authoritative for funds checks**. Rows are locked in a deterministic order (by account id) so concurrent postings cannot deadlock. Overdraft is rejected on guarded accounts (customer wallets); platform system accounts (e.g. settlement) may go negative.

The **postings remain the source of truth**; the balance is always reconcilable from them, and a reconciliation check asserts equality. The **transactional outbox continues to feed the other, eventually-consistent read models** (transaction history, analytics) asynchronously — the balance is the single projection that is maintained inline because spend decisions depend on it.

## Consequences

Positive:

- Immediate consistency for spend decisions; double-spend is prevented by the lock.
- O(1) balance reads; no summation over postings on the hot path.
- Drift is caught by an explicit per-account reconciliation (projection equals the sum of postings) and a whole-ledger zero-sum invariant.

Trade-offs / negative:

- The balance update is coupled into the write transaction, making writes slightly heavier and requiring careful lock ordering.
- Two projection mechanisms now coexist (synchronous balance, asynchronous history), which must be understood as intentional rather than inconsistent.

## Alternatives considered

- **Compute-on-read from postings** — rejected: every balance read and funds check sums postings under a lock; heavier reads with no O(1) balance.
- **Async-only projection from the outbox** — rejected: cannot safely gate spending (stale at decision time) and complicates the funds check with a separate synchronous guard.
