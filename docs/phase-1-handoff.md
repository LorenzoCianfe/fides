# Fides — Phase 1 Continuation Handoff

| Field | Value |
|---|---|
| Document | State snapshot and continuation guide for Phase 1 (walking skeleton) |
| Branch | `phase-1-walking-skeleton` — not yet PR'd (single PR at phase end) |
| Verified | `apps/api` 115/115 tests green; lint, typecheck, and production build clean |
| Last updated | 2026-07-12 |

> Resume point: **Slice 6 (hash-chained audit trail)**. Slice 5 (SCA-gated P2P transfer + dev funding + wallet transaction history, ADR-0023) is **done**. Read §4 (locked decisions) before writing code — the DI/validation convention (explicit `@Inject` tokens and explicit `ZodValidationPipe(Dto)` on params; see §6) holds for all new surface. Slice 6 wires an append-only, hash-chained audit trail into the sensitive actions now in place (transfer, funding, step-up, session revocation) and lets us revisit the ADR-0021 90-day session-retention grace once audit exists. Auth policy is pinned in ADR-0020/0021; the account model in ADR-0022; the transfer/funding/history decisions in ADR-0023.

---

## 1. One-paragraph orientation

Phase 1 is built **backend-first** ("API + tests first, clients after"). The double-entry **ledger** (Slices 1–2), the whole of **Slice 3** — identity onboarding (Wave A), WebAuthn relying party + server-side sessions (Wave B, ADR-0020), and the **`/v1/auth` HTTP surface with SCA step-up, throttling, and operational schedulers** (Wave C, ADR-0021) — **Slice 4** (accounts & wallets: event-driven idempotent provisioning off `kyc.approved` + the `/v1/accounts` read surface, ADR-0022), and **Slice 5** (the SCA-gated, idempotent internal P2P transfer, a kill-switched dev funding faucet, and the wallet transaction-history read, ADR-0023) are complete. Everything runs against a real Postgres via Testcontainers, including full HTTP journeys driven through supertest by a software authenticator producing genuine attestations and assertions — the transfer suite runs the real step-up ceremony end to end. `pnpm test` requires a running Docker daemon. Continue at Slice 6; §5 has the concrete next steps.

## 2. Status by slice

| Slice | Title | Status | Commit(s) |
|---|---|---|---|
| 1 | Ledger domain core | Done | `c7b3379` |
| 2 | Ledger persistence + async projection | Done | `4872171`, `3a05853` |
| 3 | Identity, WebAuthn, sessions, HTTP surface + SCA | Done (Waves A `0a274b8`, B `ea42e01`, C `faaf649`) | see git log |
| 4 | Accounts & wallets | Done | see git log |
| 5 | P2P transfer + dev funding | **Done** (this session) | see git log |
| 6 | Audit trail (hash-chained) | Not started | — |
| 7 | Admin RBAC + MFA + four-eyes | Not started | — |
| 8 | Clients (web + mobile) | Not started | — |

## 3. What is built

**Ledger** (`apps/api/src/modules/ledger`)
- `domain/` — account taxonomy with normal-balance rules; positive-amount `Posting`; `buildJournalEntry` (balanced by construction). `infra/` — `ledger_accounts`, `journal_entries`, `postings`, `balances` projection, `transaction_history` read model; `LedgerStore` (account creation, `Money` balance reads, reconciliation, zero-sum check).
- `application/posting.service.ts` — one transaction: idempotency claim → ordered `FOR UPDATE` balance locks → non-negative funds check on guarded accounts → entry + postings insert → balance projection update → `ledger.entry.posted` outbox append.
- `application/transaction-history.projector.ts` — idempotent async projection of `ledger.entry.posted`.
- `ledger.module.ts` — DI bindings for `LedgerStore`, `PostingService`, `TransactionHistoryProjector`.

**Identity** (`apps/api/src/modules/identity`), **KYC** (`apps/api/src/modules/kyc`)
- Wave A: `users` (unique lower-cased email), `email_verifications` (hashed codes), `RegistrationService` (user + code + KYC application; `kyc.approved` outbox event on approval), mock `KycPort` (`KYC_PORT` token, `kyc.module.ts`).
- Wave B (ADR-0020): `credentials`, `sessions` (hashed opaque access/refresh, rotation with reuse detection, idle/absolute deadlines), `devices`, `webauthn_challenges` (hashed, single-use, typed), `enrolment_tokens`; `WebAuthnService` (UV required, attestation `none`, decoys for unknown emails, counter-regression rejection); `SessionService` (issue/validate/refresh/revoke).
- Wave C (ADR-0021):
  - `EmailVerificationService` re-keyed by **email** — `verifyEmail(email, code)` returns `{ userId, enrolmentToken }` with uniform failures; `resendVerification(email)` silently re-delivers codes to passkey-less users (the enrolment-token re-issue path).
  - `SessionService.listSessions(userId)` — active sessions joined to devices, no token material.
  - SCA seam: `application/sca-grant.ts` (`ScaAction`, `computeActionHash` over `shared/crypto/canonical.ts` stable stringify, `issueScaGrant`, **`consumeScaGrant`** — the call Slice 5 makes inside the posting transaction) and `WebAuthnService.startStepUp`/`finishStepUp` (ceremony type `sca`, `action_hash` on the challenge, single-use `fsg_` grant bound to user + session + action, 5-min TTL). Schema: migration `0006` (`sca` enum value, `webauthn_challenges.action_hash`, `sca_grants`).
  - `application/identity-sweeper.ts` — ADR-0021 retention (prompt purge of dead secrets; 90-day grace for dead sessions; grants swept before sessions for the FK).
  - HTTP: `http/auth.controller.ts` (register, verify-email, resend-verification, WebAuthn registration/authentication options+verify, refresh; per-route throttles; optional-bearer resolution for additional passkeys), `http/sessions.controller.ts` (logout, list, revoke — `SessionAuthGuard`), `http/sca.controller.ts` (options, verify — guarded), `http/dtos.ts` (nestjs-zod DTOs), `identity.module.ts` (factories + module-scoped `ThrottlerModule` with `skipIf` kill-switch).

**Accounts** (`apps/api/src/modules/accounts`) — Slice 4, ADR-0022
- `infra/accounts.schema.ts` — `accounts` (one per user: unique `user_id`) and `wallets` (one per currency per account; unique 1:1 `ledger_account_id` binding). Migration `0007`. No balance column: balances are read from the ledger projection.
- `application/account-provisioning.service.ts` — the `kyc.approved` outbox handler. Runs **inside the dispatcher transaction**; creates the account, wallet, and backing ledger account (`wallet:<walletId>`, liability) atomically with the dispatch marker. Idempotent via insert-first `ON CONFLICT (user_id) DO NOTHING` (redelivery short-circuits before any ledger account is created — no orphans).
- `application/account.service.ts` — read side: `listAccounts` (principal-scoped) and `getAccount` (ownership-asserted); each wallet's live balance comes from `LedgerStore.getBalance`.
- `http/accounts.controller.ts` — `GET /v1/accounts`, `GET /v1/accounts/:accountId` (`SessionAuthGuard`, `CurrentPrincipal`, explicit `ZodValidationPipe`). `accounts.module.ts` binds the services by factory and exports `AccountProvisioningService` for the dispatcher.
- Enabling change: `LedgerStore.createAccount` takes an optional `executor` (enlist in a caller's tx, like `SessionService.issueSession`); `kyc.approved` now has a typed payload in `kyc/application/kyc-events.ts`.
- Slice 5 additions: `application/wallet-resolver.ts` (`WalletResolver` — resolve the caller's primary EUR wallet, resolve a recipient by email, and resolve an owned wallet for the history read to its `ledger_account_id`, all ownership-aware; the `ledger_account_id` never leaves the module) and `http/wallets.controller.ts` (`GET /v1/wallets/:walletId/transactions`, ownership-scoped, cursor-paginated). Both exported/wired in `accounts.module.ts`.

**Payments** (`apps/api/src/modules/payments`) — Slice 5, ADR-0023
- `application/transfer.service.ts` — `TransferService`: validates and resolves sender/recipient EUR wallets, rejects self-transfer and non-EUR, recomputes the action hash from the **executed** amount+payee via the shared `buildTransferScaAction` (never from a client action), and posts `Dr sender / Cr recipient` (sender guarded) through `PostingService.post`, consuming the single-use grant in the posting transaction via the new `onClaimed` hook. Idempotency: `actorId=userId`, `key=Idempotency-Key`, fingerprint over `{recipient, amount, currency}` (grant excluded).
- `application/funding.service.ts` — `FundingService`: the dev faucet. Kill-switch + cap checked first, then `Dr system:settlement / Cr caller-wallet` (unguarded settlement) via `PostingService.post`, no SCA. `ensureSystemAccount` lazily creates `system:settlement`.
- `http/transfers.controller.ts` (`POST /v1/transfers`), `http/dev-funding.controller.ts` (`POST /v1/dev/funding`), `http/idempotency-key.ts` (required-header helper → 400 if missing), `http/dtos.ts`. `payments.module.ts` binds the services by factory with explicit `@Inject` tokens and a module-scoped throttler (same `THROTTLE_ENABLED` kill-switch); registered in `app.module.ts` and `openapi/build-document.ts`.
- Ledger enabling change: `PostEntryCommand` gained an optional **`onClaimed(tx, now)`** hook that `PostingService.post` runs after a successful idempotency claim and before any ledger write — so the SCA grant is consumed exactly once (replays skip it) and atomically with the post. New `application/transaction-history.reader.ts` (`TransactionHistoryReader`, keyset pagination) backs the wallet history endpoint; both wired in `ledger.module.ts`. No new migration (every table already existed).

**Platform** (`apps/api/src`)
- `app.setup.ts` `configureApp` — shared by `main.ts` and tests: correlation-id middleware (honor well-formed inbound, else UUID v7; echoed; feeds the error envelope), `/v1` prefix (`/health` excluded), CORS allowlist (`CORS_ORIGINS` ?? `WEBAUTHN_ORIGINS`), global `ZodValidationPipe` + `DomainExceptionFilter` (now maps 429 → `RATE_LIMITED` and unwraps nestjs-zod issues), OpenAPI at `/docs` (`/docs-json`).
- `database.module.ts` — fail-fast on missing `DATABASE_URL`; pool closed on shutdown (`OnApplicationShutdown`).
- `shared/tokens.ts` + `shared.module.ts` — global `ID_GENERATOR`, `CLOCK`, `NOTIFICATIONS` bindings.
- `operations/` — `OutboxDispatcher` (claims only registered event types; registry now handles `ledger.entry.posted` → history projector and `kyc.approved` → account provisioning) and `IdentitySweeper` on env-tunable, overlap-guarded intervals (`OperationsScheduler`, `SCHEDULERS_ENABLED` kill-switch).

**Contracts** (`packages/contracts/src/`)
- `auth/` — Zod-first request/response schemas (`primitives`, `registration`, `webauthn`, `session`, `sca`); client-submitted WebAuthn payloads use `.passthrough()` so validation never strips spec fields; server-issued options are documentation-shaped. `auth/paths.ts` registers all `/v1/auth/*` paths + the bearer security scheme.
- `accounts/` — `account.ts` (`Account`, `Wallet` with a `Money` balance, `AccountList`, `AccountIdParams`) and `accounts/paths.ts` (`registerAccountPaths`, `/v1/accounts` + `/v1/accounts/{accountId}`). Registrars are consumed by `apps/api/src/openapi/build-document.ts`.

**Tests** (115 total) — everything under `corepack pnpm --filter @fides/api test`:
- Service-level integration: ledger (posting, projection, unknown-event pending), identity (onboarding, email-keyed verify, resend), auth (WebAuthn/session scenarios incl. re-issue path and session listing), SCA (dynamic-linking scenarios), sweeper (retention semantics), account provisioning (provision on `kyc.approved`, idempotent redelivery, per-user backlog drain), **dev-funding gating (kill-switch, cap, non-positive/non-EUR)**.
- HTTP integration (supertest against the real `AppModule`): full auth journey, error envelope, anti-enumeration, correlation ids, versioning, OpenAPI; throttling (dedicated app, kill-switch on); armed schedulers (dead row swept by the interval); accounts (`/v1/accounts` provisioning-then-read, zero EUR wallet, owner scoping incl. 401/403/404, OpenAPI presence); **payments (`/v1/transfers` two-user funded transfer with balance movement and ledger zero-sum, idempotent replay, dynamic-linking tamper rejection, single-use grant, overdraft, self-transfer, missing key; dev funding cap + auth; ownership-scoped paginated wallet history) driven through the real step-up ceremony**.
- Unit: canonical stringify, correlation middleware, auth guard, health.

## 4. Locked decisions (constraints for the rest of Phase 1)

| Area | Decision | Where |
|---|---|---|
| Auth realism | Full passkeys on web AND mobile (native passkeys need a custom Expo dev build) | Slice 8 |
| Sessions / tokens | Server-side sessions; opaque hashed tokens; rotation with reuse detection | ADR-0020 (done) |
| Token transport | **Body-only in Phase 1; bearer header for access. httpOnly-cookie mode deferred to Slice 8** | ADR-0021 |
| SCA step-up | Action-hashed `sca` challenge → fresh assertion → single-use grant; **consumed inside the posting transaction via `PostEntryCommand.onClaimed`, enforced on the P2P transfer** | ADR-0021/0023 (done) |
| P2P transfer | SCA-gated, idempotent (`Idempotency-Key` → per-actor table); action hash recomputed from executed params (dynamic linking); recipient by email; `Dr sender / Cr recipient`, sender guarded | ADR-0023 (done) |
| Dev funding | Self-service faucet from `system:settlement` (asset), kill-switched (`DEV_FUNDING_ENABLED`, off by default) + capped, no SCA; interim until admin RBAC | ADR-0023 (done) |
| Transaction history | Wallet-scoped `GET /v1/wallets/:walletId/transactions`, ownership-scoped, keyset-paginated; balance stays on the account resource | ADR-0023 (done) |
| Enumeration posture | Login decoys + uniform email-keyed verify/resend; **registration keeps explicit 409** (throttled) | ADR-0020/0021 |
| Rate limiting | `@nestjs/throttler` in-memory, module-scoped, `THROTTLE_ENABLED` kill-switch | ADR-0021 (done) |
| Retention | Dead secrets purged promptly; dead sessions kept 90 days (until Slice 6 audit) | ADR-0021 (done) |
| Outbox semantics | Dispatcher claims only registered types; `kyc.approved` handler registered and the backlog drains on dispatch | Done (Slice 4) |
| Account model | Account → wallet → ledger account (1:1 in Phase 1); no stored balance; event-driven idempotent provisioning in the dispatcher tx | ADR-0022 (done) |
| Balance model | Synchronous in-transaction balance projection, authoritative for funds checks | ADR-0019 (done) |
| Append-only | DB triggers reject UPDATE/DELETE on ledger tables | Done |
| Admin | Full RBAC + MFA + four-eyes built in Slice 7 | Slice 7 |
| Test topology | Everything under `pnpm test` (Testcontainers); HTTP suites boot the real `AppModule` | Done |
| Clients | API + tests first; clients (Slice 8) last | Sequencing |

Adopted technical defaults: UUID v7 ids; `BIGINT` minor units / `NUMERIC(38,0)` balances; explicit currency on monetary rows; Postgres idempotency table; non-negative wallets (system accounts may go negative); `/v1` prefix + correlation ids (done); no passwords; multiple passkeys, recovery deferred; feature branch + conventional commits + one PR at phase end; ADR per new decision; Testcontainers + `fast-check`; hash-chained audit in Slice 6; one Playwright happy-path in Slice 8.

## 5. Next steps

### Slice 4 — Accounts & wallets — DONE (ADR-0022)
- `kyc.approved` handler registered in the `OperationsModule` dispatcher registry; provisions one EUR account + wallet + backing ledger account (`wallet:<walletId>`, liability) via `LedgerStore.createAccount`, atomically in the dispatcher tx and idempotently.
- `accounts` module: `accounts`/`wallets` schema (migration `0007`), provisioning + read services, `GET /v1/accounts` and `GET /v1/accounts/:accountId` under the Wave C conventions; contracts + paths in `@fides/contracts`; service and HTTP integration tests.

### Slice 5 — P2P transfer + dev funding — DONE (this session, ADR-0023)
- Idempotent (`Idempotency-Key` → per-actor table), **SCA-gated** transfer (`POST /v1/transfers`): recomputes the action hash from the executed payload via the shared `buildTransferScaAction` and calls `consumeScaGrant(tx, …)` inside the `PostingService.post` transaction through the new `PostEntryCommand.onClaimed(tx, now)` hook (`Dr sender / Cr recipient`, sender guarded). Grant consumed exactly once; idempotent replay skips it. Recipient by email; fingerprint over `{recipient, amount, currency}`.
- Dev funding faucet (`POST /v1/dev/funding`) from `system:settlement` (asset, unguarded), kill-switched (`DEV_FUNDING_ENABLED`, off by default) + capped, no SCA. Wallet transaction-history read (`GET /v1/wallets/:walletId/transactions`), ownership-scoped + keyset-paginated. Balance stays on the account resource. Service + HTTP integration tests (real step-up ceremony, ledger zero-sum). Proves the Phase 1 exit criteria end to end. No new migration.

### Slices 6–8 (per `roadmap.md`)
- **6 Audit (NEXT):** append-only, hash-chained audit trail; wire into the sensitive actions now in place (transfer, funding, step-up, session revocation); revisit the ADR-0021 session-retention grace once audit exists.
- **7 Admin:** RBAC, segregation of duties, four-eyes, admin MFA (TOTP), read-only views.
- **8 Clients:** web + mobile with full passkeys; add the httpOnly-cookie transport mode for web (ADR-0021) plus security headers (helmet/HSTS); Playwright happy-path; i18n scaffolding.

## 6. Environment & workflow notes

- **Node 22, pnpm 9.12.3 via Corepack.** `pnpm` is **not on PATH** — invoke as `corepack pnpm ...`.
- **Turbo root scripts fail locally** ("cannot find pnpm binary"); run per package: `corepack pnpm --filter @fides/api <script>`. CI is unaffected.
- **`pnpm test` requires Docker** (Testcontainers Postgres, committed migrations applied). Test files run serially (`fileParallelism: false`) because they truncate a shared database.
- **DI/validation convention (important):** the vitest esbuild transform emits no `design:paramtypes`, so type-only injection silently yields `undefined` in tests. Every Nest-instantiated class (controllers, guards, schedulers) uses **explicit `@Inject(Token)`** constructor parameters, and every `@Body`/`@Param` carries an **explicit `new ZodValidationPipe(Dto)`** (the global pipe stays as a production safety net; the contracts' transforms are idempotent). Follow this for all new HTTP surface.
- **Contracts build:** `apps/api` consumes `@fides/contracts` from its built `dist` — after editing contracts run `corepack pnpm --filter @fides/contracts build` before typechecking the API.
- **Git pre-commit hook** runs `pnpm exec lint-staged`; prefix commits with the Corepack shim: `PATH="$HOME/.corepack-shims:$PATH" git commit ...`.
- **Migrations** are generated offline: `corepack pnpm --filter @fides/api exec drizzle-kit generate --name <name>` (latest: `0007_accounts_wallets`). New env vars are documented in `.env.example` (WebAuthn, session TTLs, CORS, throttle/scheduler switches and intervals). Slice 4 added no env vars.
- **Repo is PUBLIC** (`LorenzoCianfe/fides`); Dependabot tuned on `main`; framework majors deferred to Phase 7.
- **Commit cadence:** per-slice conventional commits on `phase-1-walking-skeleton`; one PR at Phase 1 completion.

## 7. How to verify

```bash
# with Docker running:
corepack pnpm --filter @fides/contracts build   # if contracts changed
corepack pnpm --filter @fides/api test          # 115 tests (Testcontainers Postgres)
corepack pnpm --filter @fides/api typecheck
corepack pnpm --filter @fides/api lint
corepack pnpm --filter @fides/api build
```

Manual smoke: `pnpm stack:up`, set `.env`, run `corepack pnpm --filter @fides/api dev`, open `http://localhost:3000/docs`.

## 8. Known gaps / watch-items

- **Token transport on web** is body-only until Slice 8 adds the httpOnly-cookie mode (ADR-0021); browser XSS exposure of the refresh token is the accepted interim risk.
- **Security headers (helmet/HSTS) not yet applied** — arrives with the clients/TLS story in Slice 8.
- **Throttle counters are in-memory** — reset on restart, per-instance only; storage seam ready for Redis if topology changes.
- **Registration 409 remains an enumeration channel by design** (throttled; ADR-0021).
- **Dev funding faucet (`POST /v1/dev/funding`) is real money-movement surface**, gated only by `DEV_FUNDING_ENABLED` (off by default) and a per-request cap; it credits only the caller's own wallet and carries no SCA. Keep it disabled in shared environments; replace it with an admin-only, four-eyes funding operation when admin RBAC lands (Slice 7). ADR-0023.
- **The transfer route exposes a throttled recipient-existence oracle** (an unknown recipient email is a 404), accepted as consistent with the registration-409 posture and mitigated by mandatory SCA + throttling; superseded when public payment handles (`@tag`) replace email as the P2P identifier (roadmap Phase 2). ADR-0023.
- Redis is still unused (sessions/challenges/idempotency are Postgres-backed; any Redis fast-path must preserve immediate revocation, ADR-0020).
- Device metadata is client-declared and untrusted until mobile attestation (Slice 8).
- WebAuthn **server-issued options schemas** in contracts are documentation-shaped (responses are not runtime-validated); client-submitted payloads are validated with `.passthrough()`.
- **Account provisioning is asynchronous:** a just-approved user has no account until the outbox dispatcher runs (`GET /v1/accounts` returns an empty list until then, never an error). With `SCHEDULERS_ENABLED=false` (the HTTP test topology), drive it explicitly via `app.get(OutboxDispatcher).dispatchPending()`.
- The `GET /v1/accounts/:accountId` route returns **403** (not 404) for an account owned by another user — a deliberate, minor existence oracle kept for consistency with `assertResourceOwnership`; account ids are non-enumerable UUID v7 (ADR-0022).
