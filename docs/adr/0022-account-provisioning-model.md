# ADR-0022: Account provisioning and the account/wallet/ledger-account model

- Status: Accepted
- Date: 2026-07-12
- Deciders: Solo maintainer
- Refines: [ADR-0005](0005-postgres-double-entry-ledger.md), [ADR-0019](0019-synchronous-balance-projection.md)

## Context

Slice 4 turns an approved KYC application into a usable account. `kyc.approved` events have been accumulating as `pending` in the outbox since Slice 3 (ADR-0021 pinned that the dispatcher only claims registered types), waiting for the consumer that provisions accounts. Three decisions were open: the data model (how an account, a wallet, and the double-entry ledger account relate), how provisioning is triggered and kept idempotent and atomic under at-least-once delivery, and where a wallet's balance lives for the read surface.

## Decision

**Three-tier model.** A customer holds an **account** (the organizing entity); an account holds one or more **wallets** (currency-specific balance holders); each wallet is backed 1:1 by a **ledger account** (`wallet:<walletId>`, `liability`) in the double-entry system of record. Phase 1 provisions exactly one EUR account with a single EUR wallet. The invariants are enforced in the schema: `accounts.user_id` is unique (one account per user), `(wallet.account_id, wallet.currency)` is unique (one wallet per currency per account), and `wallet.ledger_account_id` is unique (the 1:1 backing). Accounts and wallets are kept as **separate tables now, despite the 1:1 in Phase 1**, so multi-currency wallets (Phase 4) add rows rather than forcing a table split and data migration. No IBAN is assigned yet (Phase 2).

**Balances are not stored in the accounts module.** A wallet has no balance column. The authoritative balance is the ledger `balances` projection (ADR-0019); the read surface reads it through `LedgerStore.getBalance`. This keeps a single source of truth and rules out drift between a denormalized copy and the ledger.

**Event-driven provisioning.** Provisioning consumes the existing `kyc.approved` outbox event by registering an `AccountProvisioningService` handler in the dispatcher registry (alongside the transaction-history projector). The backlog that accrued before Slice 4 drains on the first dispatch after the handler is registered.

**Atomic and idempotent.** The handler runs **inside the dispatcher's per-row transaction**, so the account, the wallet, and the wallet's ledger account commit together with the outbox row being marked `dispatched`. To make that possible, `LedgerStore.createAccount` gained an optional `executor` parameter that enlists it in the caller's transaction instead of opening its own — the same executor-threading seam `SessionService.issueSession` already uses. Idempotency is enforced by inserting the account row first with `ON CONFLICT (user_id) DO NOTHING`: a redelivery or a concurrent claim short-circuits **before** any ledger account is created, so no orphan `wallet:<walletId>` ledger account can be left behind. Delivery is at-least-once, so the handler must be — and is — safe to run twice.

**Read surface.** `GET /v1/accounts` lists the caller's accounts (principal-scoped) with each wallet's live balance; `GET /v1/accounts/{accountId}` returns one account, asserting ownership server-side (unknown id → 404, another user's id → 403). Both follow the Wave C controller conventions (ADR-0021): `SessionAuthGuard`, explicit `@Inject` tokens, explicit `ZodValidationPipe` on params, Zod-first contracts with a colocated OpenAPI registrar.

## Consequences

Positive:

- A user has a usable, readable account immediately after onboarding, with a correct zero balance sourced from the ledger.
- Provisioning survives at-least-once delivery and partial failure without duplicate accounts or orphan ledger accounts; the whole operation is one transaction.
- The `createAccount` executor seam is reused by the Slice 5 transfer (which posts inside its own transaction) and by any future in-transaction ledger-account creation.
- The account/wallet split absorbs multi-currency wallets (Phase 4) additively.

Trade-offs / negative:

- Account and wallet are 1:1 in Phase 1, so the separation is structure carried ahead of its use.
- Provisioning is asynchronous: a just-approved user has no account until the dispatcher runs. The interval is short and env-tunable; the read surface returns an empty list until then rather than erroring.
- The by-id route returns **403 (not 404)** for an account owned by another user — a minor existence oracle, accepted because account ids are non-enumerable UUID v7 values and it keeps the shared `assertResourceOwnership` helper (403) uniform across the platform.

## Alternatives considered

- **Single combined account+wallet table** — rejected: simpler in Phase 1 but forces a table split and data migration when multi-currency wallets arrive (Phase 4).
- **A denormalized balance column on the wallet** — rejected: duplicates the ledger projection and invites drift; the projection is already O(1) and authoritative (ADR-0019).
- **Synchronous provisioning inside registration** — rejected: couples onboarding to the ledger and accounts modules and forfeits the outbox's at-least-once retry; the `kyc.approved` seam existed for exactly this hand-off.
- **Provisioning in its own transaction (leaving `createAccount` unchanged)** — rejected: the ledger account would commit outside the dispatch transaction; a partial failure would orphan a `wallet:<walletId>` ledger account that a retry (which mints a fresh `walletId`) can never reclaim.
