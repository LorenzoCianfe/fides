# ADR-0023: Internal P2P transfer — SCA enforcement, dev funding, and the transaction-history read

- Status: Accepted
- Date: 2026-07-12
- Deciders: Solo maintainer
- Refines: [ADR-0019](0019-synchronous-balance-projection.md), [ADR-0021](0021-http-auth-surface-policy.md), [ADR-0022](0022-account-provisioning-model.md)

## Context

Slice 5 delivers the transfer that proves the Phase 1 exit criteria end to end: value moves between two users with a balanced journal entry, balances reconcile, and the flow is covered by integration and ledger-invariant tests. The enforcement primitives already exist — the double-entry posting path with a synchronous, authoritative balance projection (ADR-0019), the single-use SCA grant with PSD2 dynamic linking (ADR-0021), and the wallet-backed ledger accounts provisioned on approval (ADR-0022). What was open was how they compose: where the step-up grant is consumed relative to the money transaction and the idempotency claim, how the recipient is identified and the action bound, how a wallet is funded before admin RBAC exists (Slice 7), and where the balance and transaction-history reads live.

## Decision

**SCA is enforced inside the posting transaction, on first execution only.** The transfer recomputes the action hash from the *executed* amount and payee — never from a client-supplied action blob — and consumes the single-use grant (`consumeScaGrant`) atomically with the posting. To make that composition clean without leaking the ledger's idempotency-replay control flow into the payments module, `PostEntryCommand` gained an optional `onClaimed(tx, now)` hook that `PostingService` invokes **after a successful idempotency claim and before any ledger write**. Because a replayed (already-claimed) request returns the stored result before the hook runs, the grant is consumed **exactly once**: a legitimate retry with the same `Idempotency-Key` replays the original response without re-consuming or re-posting, and any failure inside the transaction (a mismatched hash, insufficient funds) rolls back the claim and the consumption together, freeing the key and leaving the grant unspent.

**The recipient is identified by email.** It is the natural P2P identifier (users are keyed by a unique lower-cased email) and makes the flow demonstrable. Resolution is server-side (email → user → EUR wallet → `ledger_account_id`); an unknown recipient is a 404. That 404 is a minor existence oracle, accepted as consistent with the existing registration-409 posture (ADR-0021) and mitigated by the mandatory step-up and per-route throttling. A privacy-preserving public payment handle (`@tag`) is recorded on the roadmap as the future alternative.

**Dynamic linking is a shared, canonical action.** A framework-free `buildTransferScaAction({ recipient, amount, currency })` in `@fides/contracts` constructs the `{ type: 'p2p_transfer', payload }` object that both the client signs during step-up and the server rebuilds at execution time, so the hashed amount and payee are byte-identical on both sides. `amount` is integer minor units as a string; `recipient` is the normalized email. A tampered field changes the hash and grant consumption fails with the generic authentication error.

**Idempotency maps per actor over the linked parameters.** `actorId` is the authenticated sender, `key` is the `Idempotency-Key` header (required; missing is a 400), `operation` is `p2p_transfer`, and the request fingerprint is a hash of `{ recipient, amount, currency }` — the same parameters dynamic linking protects. The grant is deliberately excluded from the fingerprint: a legitimate retry may carry a fresh one, and reusing a key with different money parameters is a clean conflict (409).

**Dev funding is a kill-switched self-service faucet.** `POST /v1/dev/funding` credits the caller's own EUR wallet from `system:settlement` (asset, unguarded — it may go negative, ADR-0019) with a balanced entry. It is session-guarded, idempotent, amount-capped, and gated by `DEV_FUNDING_ENABLED` (off by default; when disabled the route answers 404 so it reads as absent). It carries **no SCA** — crediting one's own wallet is not a PSD2 payment. This is an explicit development affordance until admin RBAC and a proper funding operation land in Slice 7.

**Balance stays on the account resource; history is a new wallet-scoped read.** The wallet balance is already served by `GET /v1/accounts` from the authoritative projection, so no separate balance endpoint is added. `GET /v1/wallets/{walletId}/transactions` serves the per-wallet history from the `transaction_history` projection, ownership-scoped (the wallet is resolved to its owner and ownership asserted server-side) and keyset-paginated over `(occurred_at desc, journal_entry_id desc)` — a stable total order, so pages never skip or duplicate as new entries arrive.

## Consequences

Positive:

- The Phase 1 exit criteria are met: an SCA-gated, idempotent transfer moves value between two users with a balanced entry; balances reconcile and the whole ledger nets to zero, asserted by integration and ledger-invariant tests.
- Dynamic linking is enforced against the executed parameters, not a client assertion, so a signed action cannot authorize a different transfer; the `onClaimed` ordering makes the grant single-use and retry-safe simultaneously.
- The `onClaimed` seam is minimal and reusable: `PostingService` remains the sole owner of the money transaction, and any future guarded posting (e.g. card authorization) can weave an in-transaction check the same way.
- A wallet can be funded and a transfer demonstrated without admin tooling, behind a switch that defaults off.

Trade-offs / negative:

- Email recipients expose a throttled existence oracle on the transfer route; accepted for Phase 1 and superseded when payment handles arrive.
- The dev funding faucet is real money-movement surface that must be disabled in shared environments and removed/replaced when admin RBAC lands (Slice 7); it is documented as a known gap in `security.md` and the handoff.
- `PostEntryCommand` now carries an optional behavioural hook, a small increase in the posting contract's surface justified by keeping idempotency-replay logic encapsulated in the ledger.

## Alternatives considered

- **Refactor `PostingService.post` to enlist in a caller-opened transaction** (the `executor` seam used by `createAccount`) — rejected: the transfer would own the transaction and consume the grant, but the idempotency claim-or-replay decision would have to move into the caller, duplicating sensitive control flow outside the ledger. The `onClaimed` hook keeps it in one place.
- **Consume the grant before the posting transaction** — rejected: a separate transaction cannot roll the consumption back atomically with a failed post, and it would break idempotent replay (the retry would find the grant already spent).
- **Recipient by account id or wallet id** — rejected for Phase 1: non-enumerable but unrealistic for a real P2P send; nobody exchanges account UUIDs to receive money. A public `@tag` handle is the eventual answer (roadmap), not raw ids.
- **Fingerprint the whole request body (including the grant)** — rejected: the grant legitimately varies across retries; fingerprinting the linked money parameters is both sufficient and aligned with what dynamic linking guarantees.
- **Dev funding as a first-class endpoint, or as a test-only seam** — rejected: a first-class route would read as a permanent feature and risk outliving Slice 7; a test-only seam would leave no way to fund a wallet for a manual demo. A kill-switched, self-scoped faucet is the least-privilege middle ground.
- **A dedicated balance endpoint** — rejected: the account resource already exposes the authoritative wallet balance; a second source invites drift.
