# Fides — Phase 1 Continuation Handoff

| Field | Value |
|---|---|
| Document | State snapshot and continuation guide for Phase 1 (walking skeleton) |
| Branch | `phase-1-walking-skeleton` — 4 commits ahead of `main`, not yet PR'd (single PR at phase end) |
| Verified | `apps/api` 30/30 tests green; lint, typecheck, and production build clean |
| Last updated | 2026-07-05 |

> Resume point: **Slice 3, Wave B** (WebAuthn relying party + server-side sessions). Read §4 (locked decisions) before writing code — several constraints are not yet expressed in the codebase.

---

## 1. One-paragraph orientation

Phase 1 is built **backend-first** ("API + tests first, clients after"). The double-entry **ledger** (Slices 1–2) and the **identity onboarding foundation** (Slice 3 Wave A) are complete and covered by integration tests that run against a real Postgres via Testcontainers. All work lives in `apps/api`. `pnpm test` requires a running Docker daemon. Continue at Slice 3 Wave B; §5 has the concrete next steps.

## 2. Status by slice

| Slice | Title | Status | Commit(s) |
|---|---|---|---|
| 1 | Ledger domain core | Done | `c7b3379` |
| 2 | Ledger persistence + async projection | Done | `4872171`, `3a05853` |
| 3 | Identity, WebAuthn, sessions | **Wave A done**; Wave B + C remaining | `0a274b8` |
| 4 | Accounts & wallets | Not started | — |
| 5 | P2P transfer + dev funding | Not started | — |
| 6 | Audit trail (hash-chained) | Not started | — |
| 7 | Admin RBAC + MFA + four-eyes | Not started | — |
| 8 | Clients (web + mobile) | Not started | — |

## 3. What is built

**Ledger** (`apps/api/src/modules/ledger`)
- `domain/` — account taxonomy (`asset`/`liability`/`equity`/`income`/`expense`) with normal-balance rules; positive-amount `Posting` + direction; `buildJournalEntry` enforcing debits = credits per currency (balanced by construction).
- `infra/ledger.schema.ts` — `ledger_accounts`, `journal_entries`, `postings`, `balances` (projection). `infra/transaction-history.schema.ts` — `transaction_history` read model.
- `infra/ledger.repository.ts` (`LedgerStore`) — account creation (+ eager zero-balance row), `Money` balance reads, `reconcileAccount`, `sumSignedByCurrency` (whole-ledger zero-sum).
- `application/posting.service.ts` (`PostingService`) — one transaction: claim idempotency → lock affected balance rows `FOR UPDATE` (ordered by account id) → non-negative funds check on guarded accounts → insert entry + postings → update balance projection → append `ledger.entry.posted` to the outbox.
- `application/transaction-history.projector.ts` + `application/ledger-events.ts` — projects `ledger.entry.posted` into `transaction_history` (one idempotent row per affected account, carrying signed amount, running balance, counterparties).

**Identity** (`apps/api/src/modules/identity`), **KYC** (`apps/api/src/modules/kyc`)
- `identity/infra/identity.schema.ts` — `users` (unique lower-cased email, `onboarding|active|suspended`, natural-person fields), `email_verifications` (SHA-256 code hash).
- `identity/application/registration.service.ts` — creates user + verification code (via `NotificationPort`) + KYC application, submits to `KycPort`, applies the decision, emits `kyc.approved` for downstream provisioning.
- `identity/application/email-verification.service.ts` — verifies the code, sets `email_verified_at`.
- `kyc/application/kyc.port.ts` + `kyc/infra/mock-kyc.adapter.ts` — port + dev auto-approve adapter. `kyc/infra/kyc.schema.ts` — `kyc_applications`.

**Shared** (`apps/api/src/shared`)
- `ids/uuid-v7.ts` (`UuidV7Generator`), `time/system-clock.ts` (`SystemClock`).
- `idempotency/` — per-actor `idempotency_keys` + claim/complete (exactly-once, replay).
- `outbox/outbox.writer.ts` (append within a tx) + `outbox/outbox.dispatcher.ts` (`OutboxDispatcher`: `FOR UPDATE SKIP LOCKED`, at-least-once, attempt-bounded retry; handler registry keyed by event type).
- `notifications/` — `NotificationPort` + `ConsoleNotificationAdapter`.
- `crypto/secrets.ts` — `sha256Hex`, `generateNumericCode`.

**Database** — migrations under `apps/api/drizzle/`: `0000_` outbox, `0001_` ledger core, `0002_` append-only triggers (block UPDATE/DELETE on `ledger_accounts`/`journal_entries`/`postings`), `0003_` transaction_history, `0004_` identity + KYC. `db.types.ts` exports `Database`/`DatabaseTx`/`DbExecutor`. The schema barrel is `src/database/schema/index.ts` (drizzle-kit reads it).

## 4. Locked decisions (constraints for the rest of Phase 1)

Pivotal choices made this session. Those not yet in code must be honored when implementing Wave B/C and later slices.

| Area | Decision | Where |
|---|---|---|
| Auth realism | **Full passkeys on web AND mobile** (native mobile passkeys need a custom Expo dev build, not Expo Go) | Slice 3/8 |
| Sessions | **Server-side sessions** (Postgres) with immediate revocation | Slice 3 Wave B |
| Access token | **Opaque token, validated against the session row on every request** (not JWT); rotating **hashed** refresh | Slice 3 Wave B |
| Email verification | **Real code flow**, delivered via the console `NotificationPort` in dev | Done (Wave A) |
| SCA step-up | **Fresh WebAuthn assertion with dynamic linking** (challenge bound to amount + payee) | Slice 3 Wave C / Slice 5 |
| Admin | **Full RBAC + MFA + four-eyes built now** (even though Phase 1 admin is read-only) | Slice 7 |
| Balance model | **Synchronous in-transaction balance projection**, authoritative for funds checks | ADR-0019 (done) |
| Append-only | **Database triggers** reject UPDATE/DELETE on ledger tables | Done (0002) |
| Transaction history | **Dedicated async projection** via the outbox dispatcher | Done (Wave 2) |
| Test topology | **Everything under `pnpm test`** — integration tests boot Docker/Testcontainers | Done |
| Clients | **API + tests first**, clients (Slice 8) last | Sequencing |
| SAST | **Repo made public** to get free CodeQL (private repo lacked GitHub Advanced Security) | Done |

Adopted technical defaults (delegated): UUID v7 ids; `BIGINT` per-posting minor units / `NUMERIC(38,0)` balances; explicit currency on every monetary row; Postgres idempotency table; non-negative wallets with debtor row lock (system accounts may go negative); `/v1` API prefix + correlation-id middleware (to wire in Wave C); no passwords (passkeys-first, email is the identifier); multiple passkeys per user, recovery deferred; feature branch + conventional commits + one PR at phase end; ADR per new decision; Testcontainers + `fast-check`; hash-chained audit table in Slice 6; one Playwright happy-path in Slice 8.

## 5. Next steps

### Slice 3 — Wave B (WebAuthn + sessions)
1. Add dependency `@simplewebauthn/server` to `apps/api`.
2. Schema: `credentials` (id, userId, credentialId unique, publicKey, counter, transports, deviceName, createdAt), `sessions` (id, userId, deviceId, accessTokenHash, refreshTokenHash, createdAt, expiresAt, lastUsedAt, revokedAt), `devices` (id, userId, name, platform, createdAt). Add to the schema barrel + `resetDb` TRUNCATE list; `drizzle-kit generate`.
3. WebAuthn RP service: registration ceremony (`generateRegistrationOptions` / `verifyRegistrationResponse`) and authentication ceremony (`generateAuthenticationOptions` / `verifyAuthenticationResponse`). Make RP ID / expected origin env-configurable (dev web = `localhost`); store the challenge server-side (short-lived) between option issue and verification.
4. Session service: issue an **opaque** access token (random, stored hashed on the session) + rotating hashed refresh; a `validateAccessToken` that reads the session row and rejects revoked/expired; `revokeSession`.
5. Auth guard + resource-ownership authorization helper.
6. Tests with a virtual authenticator (`@simplewebauthn/server` supports supplying verification inputs) covering register → login → refresh → revoke and ownership checks.

### Slice 3 — Wave C (API surface + SCA)
- NestJS wiring: `/v1` prefix, correlation-id middleware, DI providers for `DRIZZLE`/ids/clock/ports, module registration (identity, kyc, ledger). HTTP endpoints: register, verify-email, WebAuthn option/verify (register + auth), login, refresh, logout. Zod contracts in `packages/contracts` + OpenAPI at `/docs`.
- SCA step-up seam: a challenge bound to the action (dynamic linking), verified by a fresh WebAuthn assertion; enforce on the transfer in Slice 5.
- Basic rate limiting on auth endpoints. Schedule the `OutboxDispatcher` in the running app (e.g. `@nestjs/schedule` interval) — it is currently only invoked directly in tests.

### Slices 4–8 (per `roadmap.md`)
- **4 Accounts/wallets:** consume `kyc.approved` → provision one EUR account + wallet + backing ledger account (`wallet:<walletId>`, liability) via `LedgerStore.createAccount`.
- **5 Transfer + funding:** idempotent, SCA-gated, audited P2P over `PostingService` (`Dr sender / Cr recipient`); dev/admin funding from `system:settlement` (asset); balance + history read endpoints. This proves the Phase 1 exit criteria.
- **6 Audit:** append-only, hash-chained audit trail; wire into sensitive actions.
- **7 Admin:** full RBAC (roles), segregation of duties, four-eyes, admin MFA (TOTP), read-only user/account/ledger views.
- **8 Clients:** web + mobile with full passkeys, home/balance, send money, history; Playwright happy-path; i18n scaffolding.

## 6. Environment & workflow notes

- **Node 22, pnpm 9.12.3 via Corepack.** `pnpm` is **not on PATH** — invoke as `corepack pnpm ...`.
- **Turbo root scripts fail locally** (`pnpm lint` / `typecheck` / `test` → "cannot find pnpm binary" because Turbo can't resolve pnpm under Corepack). Run per package instead: `corepack pnpm --filter @fides/api <script>`. This is a local-only quirk; CI (with `pnpm/action-setup`) is unaffected.
- **`pnpm test` requires Docker.** `apps/api` Vitest `globalSetup` boots an ephemeral Postgres (Testcontainers) and applies the committed migrations. Start Docker Desktop first.
- **Git pre-commit hook** runs `pnpm exec lint-staged`. Because `pnpm` is not on PATH, a Corepack shim was installed at `~/.corepack-shims`; prefix commits with it: `PATH="$HOME/.corepack-shims:$PATH" git commit ...`. (Running `corepack enable` from an elevated shell would make `pnpm` global and remove the need.)
- **Repo is PUBLIC** (`LorenzoCianfe/fides`) — enables free CodeQL. **Dependabot is tuned on `main`** (monthly, grouped, npm majors ignored); framework major upgrades (NestJS 11, Next 16, Expo 57, …) were deliberately deferred to Phase 7. **0 open PRs.**
- **Commit cadence:** per-slice conventional commits on `phase-1-walking-skeleton`; nothing from this branch is merged to `main` yet; open one PR at Phase 1 completion. Commits carry the `Co-Authored-By: Claude Opus 4.8` trailer.
- Migrations are generated offline: `corepack pnpm --filter @fides/api exec drizzle-kit generate --name <name>`.

## 7. How to verify

```bash
# with Docker running:
corepack pnpm --filter @fides/api test        # 30 tests (Testcontainers Postgres)
corepack pnpm --filter @fides/api typecheck
corepack pnpm --filter @fides/api lint
corepack pnpm --filter @fides/api build
```

## 8. Known gaps / watch-items

- No NestJS HTTP wiring yet — identity/ledger services are headless (exercised directly by integration tests). Controllers, DI modules, `/v1`, and OpenAPI routes arrive in Slice 3 Wave C.
- The `OutboxDispatcher` is not scheduled in the running app yet (tests call `dispatchPending()` directly). Add a scheduler in Wave C.
- `@nestjs/schedule` and `@simplewebauthn/server` are not yet dependencies.
- Redis is defined in the local stack but not yet used (idempotency + sessions are Postgres-backed for now; a Redis fast-path is a later optimization).
