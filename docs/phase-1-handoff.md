# Fides — Phase 1 Continuation Handoff

| Field | Value |
|---|---|
| Document | State snapshot and continuation guide for Phase 1 (walking skeleton) |
| Branch | `phase-1-walking-skeleton` — not yet PR'd (single PR at phase end) |
| Verified | `apps/api` 60/60 tests green; lint, typecheck, and production build clean |
| Last updated | 2026-07-06 |

> Resume point: **Slice 3, Wave C** (NestJS HTTP surface + SCA seam). Read §4 (locked decisions) before writing code — the remaining constraints (`/v1` prefix, correlation IDs, SCA dynamic linking) are not yet expressed in the codebase. Ceremony/session policy is pinned in ADR-0020.

---

## 1. One-paragraph orientation

Phase 1 is built **backend-first** ("API + tests first, clients after"). The double-entry **ledger** (Slices 1–2), the **identity onboarding foundation** (Slice 3 Wave A), and the **WebAuthn relying party + server-side sessions** (Slice 3 Wave B, policy in ADR-0020) are complete and covered by integration tests that run against a real Postgres via Testcontainers — the WebAuthn ceremonies are exercised end to end by a software authenticator producing real attestations and assertions. All work lives in `apps/api`; everything is still headless (no HTTP layer). `pnpm test` requires a running Docker daemon. Continue at Slice 3 Wave C; §5 has the concrete next steps.

## 2. Status by slice

| Slice | Title | Status | Commit(s) |
|---|---|---|---|
| 1 | Ledger domain core | Done | `c7b3379` |
| 2 | Ledger persistence + async projection | Done | `4872171`, `3a05853` |
| 3 | Identity, WebAuthn, sessions | **Waves A + B done**; Wave C remaining | `0a274b8`, `ea42e01` |
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
- `identity/application/email-verification.service.ts` — verifies the code, sets `email_verified_at`, and issues the one-time **enrolment token** gating the first passkey.
- `kyc/application/kyc.port.ts` + `kyc/infra/mock-kyc.adapter.ts` — port + dev auto-approve adapter. `kyc/infra/kyc.schema.ts` — `kyc_applications`.

**Identity auth — Wave B** (`apps/api/src/modules/identity`, policy in ADR-0020)
- `infra/auth.schema.ts` — `credentials` (passkeys: base64url id/COSE key, counter, deviceType/backedUp), `sessions` (hashed opaque access+refresh, previous refresh hash for reuse detection, idle/absolute deadlines, revocation), `devices` (client-declared, unique per user+name+platform), `webauthn_challenges` (hashed, single-use, typed, nullable user for decoys), `enrolment_tokens` (hashed, single-use).
- `application/webauthn.service.ts` (`WebAuthnService`) — registration + email-first authentication ceremonies over `@simplewebauthn/server` v13: UV **required**, attestation `none`, ES256/RS256, `residentKey: preferred`, excludeCredentials on re-registration, counter-regression rejection, decoy options for unknown emails, challenge consumed atomically regardless of outcome. First passkey consumes the enrolment token and **auto-issues a session**; additional passkeys require `authenticatedUserId`.
- `application/session.service.ts` (`SessionService`) — `issueSession` (device match-or-create; runs on the caller's executor), `validateAccessToken` (session⋈user single query: revocation, expiries, suspended cut-off; throttled `lastUsedAt`), `refresh` (rotation with reuse detection — the revocation commits before the error is raised), `revokeSession` (idempotent, ownership-scoped). TTLs 15 m / 30 d idle / 90 d absolute via `SessionConfig` (env `SESSION_*_TTL_MS`).
- `application/enrolment-token.ts` — issue/validate/consume helpers (15-min TTL); `application/auth.guard.ts` (`SessionAuthGuard`, `extractBearerToken`) and `application/authorization.ts` (`assertResourceOwnership`) — headless, wired to HTTP in Wave C.
- `shared/crypto/secrets.ts` — added `generateToken` (prefixed 256-bit base64url; only SHA-256 stored).
- Env additions: `WEBAUTHN_RP_ID` (default `localhost`), `WEBAUTHN_ORIGINS` (comma-separated; default `http://localhost:3001`), optional `SESSION_*_TTL_MS`.
- Tests: `auth.integration.test.ts` (18 scenarios: enrolment gating, replay/expiry/origin/RP-ID/UV failures, additional passkey, decoys, counter regression, suspension, rotation, reuse-revocation, idle/absolute expiry, ownership-scoped revocation) driven by `test/webauthn.ts` — a software P-256 authenticator emitting real CBOR/ECDSA payloads; `auth.guard.test.ts` unit tests; `test/clock.ts` (`TestClock`) for deterministic TTLs.

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
| Sessions | **Server-side sessions** (Postgres) with immediate revocation | Done (Wave B, ADR-0020) |
| Access token | **Opaque token, validated against the session row on every request** (not JWT); rotating **hashed** refresh with reuse detection | Done (Wave B, ADR-0020) |
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

### Slice 3 — Wave C (API surface + SCA)
- NestJS wiring: `/v1` prefix, correlation-id middleware, DI providers for `DRIZZLE`/ids/clock/ports (including `SessionConfig`/`WebAuthnConfig` from env), module registration (identity, kyc, ledger). HTTP endpoints: register, verify-email, WebAuthn option/verify (register + auth), login, refresh, logout, session list/revoke. Zod contracts in `packages/contracts` + OpenAPI at `/docs`. Wire `SessionAuthGuard` (built in Wave B) into the protected routes.
- A **re-issue path for the enrolment token** (resend verification flow) for users whose token expires before the first passkey is enrolled — the Wave B services deliberately have no such backdoor.
- SCA step-up seam: a challenge bound to the action (dynamic linking), verified by a fresh WebAuthn assertion; enforce on the transfer in Slice 5. Reuse the `webauthn_challenges` machinery (new ceremony type or an action-hash column).
- Basic rate limiting on auth endpoints. Schedule the `OutboxDispatcher` in the running app (e.g. `@nestjs/schedule` interval) — it is currently only invoked directly in tests. `@nestjs/schedule` is not yet a dependency (`@simplewebauthn/server` now is).

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
corepack pnpm --filter @fides/api test        # 60 tests (Testcontainers Postgres)
corepack pnpm --filter @fides/api typecheck
corepack pnpm --filter @fides/api lint
corepack pnpm --filter @fides/api build
```

## 8. Known gaps / watch-items

- No NestJS HTTP wiring yet — identity/ledger services are headless (exercised directly by integration tests). Controllers, DI modules, `/v1`, and OpenAPI routes arrive in Slice 3 Wave C. `SessionAuthGuard` exists but is not attached to any route.
- The `OutboxDispatcher` is not scheduled in the running app yet (tests call `dispatchPending()` directly). Add a scheduler in Wave C (`@nestjs/schedule` still not a dependency).
- No enrolment-token re-issue path: a user whose token expires before enrolling the first passkey needs the Wave C resend-verification flow.
- Expired/consumed `webauthn_challenges`, `enrolment_tokens`, and dead sessions accumulate (correctness is unaffected — every read filters on expiry/consumption); add opportunistic or scheduled cleanup alongside the Wave C scheduler.
- Redis is defined in the local stack but not yet used (idempotency + sessions + challenges are Postgres-backed for now; a Redis fast-path is a later optimization that must preserve immediate revocation, per ADR-0020).
- Device metadata is client-declared and untrusted until mobile attestation (Slice 8).
