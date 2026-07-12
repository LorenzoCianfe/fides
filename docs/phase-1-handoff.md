# Fides — Phase 1 Continuation Handoff

| Field | Value |
|---|---|
| Document | State snapshot and continuation guide for Phase 1 (walking skeleton) |
| Branch | `phase-1-walking-skeleton` — not yet PR'd (single PR at phase end) |
| Verified | `apps/api` 95/95 tests green; lint, typecheck, and production build clean |
| Last updated | 2026-07-06 |

> Resume point: **Slice 4 (accounts & wallets)**. Read §4 (locked decisions) before writing code — in particular the DI/validation convention (explicit `@Inject` tokens and explicit `ZodValidationPipe(Dto)` on params; see §6) and the SCA grant contract the Slice 5 transfer must consume. Auth policy is pinned in ADR-0020/ADR-0021.

---

## 1. One-paragraph orientation

Phase 1 is built **backend-first** ("API + tests first, clients after"). The double-entry **ledger** (Slices 1–2) and the whole of **Slice 3** — identity onboarding (Wave A), WebAuthn relying party + server-side sessions (Wave B, ADR-0020), and the **`/v1/auth` HTTP surface with SCA step-up, throttling, and operational schedulers** (Wave C, ADR-0021) — are complete. Everything runs against a real Postgres via Testcontainers, including full HTTP journeys driven through supertest by a software authenticator producing genuine attestations and assertions. `pnpm test` requires a running Docker daemon. Continue at Slice 4; §5 has the concrete next steps.

## 2. Status by slice

| Slice | Title | Status | Commit(s) |
|---|---|---|---|
| 1 | Ledger domain core | Done | `c7b3379` |
| 2 | Ledger persistence + async projection | Done | `4872171`, `3a05853` |
| 3 | Identity, WebAuthn, sessions, HTTP surface + SCA | **Done** (Waves A `0a274b8`, B `ea42e01`, C — this session) | see git log |
| 4 | Accounts & wallets | Not started | — |
| 5 | P2P transfer + dev funding | Not started | — |
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

**Platform** (`apps/api/src`)
- `app.setup.ts` `configureApp` — shared by `main.ts` and tests: correlation-id middleware (honor well-formed inbound, else UUID v7; echoed; feeds the error envelope), `/v1` prefix (`/health` excluded), CORS allowlist (`CORS_ORIGINS` ?? `WEBAUTHN_ORIGINS`), global `ZodValidationPipe` + `DomainExceptionFilter` (now maps 429 → `RATE_LIMITED` and unwraps nestjs-zod issues), OpenAPI at `/docs` (`/docs-json`).
- `database.module.ts` — fail-fast on missing `DATABASE_URL`; pool closed on shutdown (`OnApplicationShutdown`).
- `shared/tokens.ts` + `shared.module.ts` — global `ID_GENERATOR`, `CLOCK`, `NOTIFICATIONS` bindings.
- `operations/` — `OutboxDispatcher` (now **only claims registered event types**; `kyc.approved` stays `pending` for Slice 4) and `IdentitySweeper` on env-tunable, overlap-guarded intervals (`OperationsScheduler`, `SCHEDULERS_ENABLED` kill-switch).

**Contracts** (`packages/contracts/src/auth/`)
- Zod-first request/response schemas (`primitives`, `registration`, `webauthn`, `session`, `sca`) — client-submitted WebAuthn payloads use `.passthrough()` so validation never strips spec fields; server-issued options are documentation-shaped. `auth/paths.ts` registers all `/v1/auth/*` paths + the bearer security scheme on the shared OpenAPI registry (consumed by `apps/api/src/openapi/build-document.ts`).

**Tests** (95 total) — everything under `corepack pnpm --filter @fides/api test`:
- Service-level integration: ledger (posting, projection, unknown-event pending), identity (onboarding, email-keyed verify, resend), auth (19 WebAuthn/session scenarios incl. re-issue path and session listing), SCA (9 dynamic-linking scenarios), sweeper (retention semantics).
- HTTP integration (supertest against the real `AppModule`): full journey, error envelope, anti-enumeration, correlation ids, versioning, OpenAPI; throttling (dedicated app, kill-switch on); armed schedulers (dead row swept by the interval).
- Unit: canonical stringify, correlation middleware, auth guard, health.

## 4. Locked decisions (constraints for the rest of Phase 1)

| Area | Decision | Where |
|---|---|---|
| Auth realism | Full passkeys on web AND mobile (native passkeys need a custom Expo dev build) | Slice 8 |
| Sessions / tokens | Server-side sessions; opaque hashed tokens; rotation with reuse detection | ADR-0020 (done) |
| Token transport | **Body-only in Phase 1; bearer header for access. httpOnly-cookie mode deferred to Slice 8** | ADR-0021 |
| SCA step-up | **Action-hashed `sca` challenge → fresh assertion → single-use grant; Slice 5 calls `consumeScaGrant` inside the posting transaction** | ADR-0021 (seam done) |
| Enumeration posture | Login decoys + uniform email-keyed verify/resend; **registration keeps explicit 409** (throttled) | ADR-0020/0021 |
| Rate limiting | `@nestjs/throttler` in-memory, module-scoped, `THROTTLE_ENABLED` kill-switch | ADR-0021 (done) |
| Retention | Dead secrets purged promptly; dead sessions kept 90 days (until Slice 6 audit) | ADR-0021 (done) |
| Outbox semantics | Dispatcher claims only registered types — **Slice 4 registers a `kyc.approved` handler and the backlog drains automatically** | Done (Wave C) |
| Balance model | Synchronous in-transaction balance projection, authoritative for funds checks | ADR-0019 (done) |
| Append-only | DB triggers reject UPDATE/DELETE on ledger tables | Done |
| Admin | Full RBAC + MFA + four-eyes built in Slice 7 | Slice 7 |
| Test topology | Everything under `pnpm test` (Testcontainers); HTTP suites boot the real `AppModule` | Done |
| Clients | API + tests first; clients (Slice 8) last | Sequencing |

Adopted technical defaults: UUID v7 ids; `BIGINT` minor units / `NUMERIC(38,0)` balances; explicit currency on monetary rows; Postgres idempotency table; non-negative wallets (system accounts may go negative); `/v1` prefix + correlation ids (done); no passwords; multiple passkeys, recovery deferred; feature branch + conventional commits + one PR at phase end; ADR per new decision; Testcontainers + `fast-check`; hash-chained audit in Slice 6; one Playwright happy-path in Slice 8.

## 5. Next steps

### Slice 4 — Accounts & wallets
- Consume `kyc.approved`: register a handler in the `OperationsModule` dispatcher registry (the pending backlog drains on first dispatch) that provisions one EUR account + wallet + backing ledger account (`wallet:<walletId>`, liability) via `LedgerStore.createAccount`, idempotently (the handler may be re-delivered).
- `accounts` module: schema (accounts, wallets), application service, read endpoint(s) under `/v1/accounts` following the Wave C controller conventions (explicit `@Inject`, explicit `ZodValidationPipe(Dto)`, contracts + paths in `@fides/contracts`, integration tests over HTTP).

### Slice 5 — P2P transfer + dev funding
- Idempotent (`Idempotency-Key` header → per-actor idempotency table), **SCA-gated** transfer: recompute the action hash from the transfer payload and call `consumeScaGrant(tx, { userId, sessionId, grant, actionHash, now })` inside the same transaction as `PostingService.post` (`Dr sender / Cr recipient`, sender wallet guarded).
- Dev/admin funding from `system:settlement` (asset); balance + history read endpoints. This proves the Phase 1 exit criteria end to end.

### Slices 6–8 (per `roadmap.md`)
- **6 Audit:** append-only, hash-chained audit trail; wire into sensitive actions; revisit the ADR-0021 session-retention grace once audit exists.
- **7 Admin:** RBAC, segregation of duties, four-eyes, admin MFA (TOTP), read-only views.
- **8 Clients:** web + mobile with full passkeys; add the httpOnly-cookie transport mode for web (ADR-0021) plus security headers (helmet/HSTS); Playwright happy-path; i18n scaffolding.

## 6. Environment & workflow notes

- **Node 22, pnpm 9.12.3 via Corepack.** `pnpm` is **not on PATH** — invoke as `corepack pnpm ...`.
- **Turbo root scripts fail locally** ("cannot find pnpm binary"); run per package: `corepack pnpm --filter @fides/api <script>`. CI is unaffected.
- **`pnpm test` requires Docker** (Testcontainers Postgres, committed migrations applied). Test files run serially (`fileParallelism: false`) because they truncate a shared database.
- **DI/validation convention (important):** the vitest esbuild transform emits no `design:paramtypes`, so type-only injection silently yields `undefined` in tests. Every Nest-instantiated class (controllers, guards, schedulers) uses **explicit `@Inject(Token)`** constructor parameters, and every `@Body`/`@Param` carries an **explicit `new ZodValidationPipe(Dto)`** (the global pipe stays as a production safety net; the contracts' transforms are idempotent). Follow this for all new HTTP surface.
- **Contracts build:** `apps/api` consumes `@fides/contracts` from its built `dist` — after editing contracts run `corepack pnpm --filter @fides/contracts build` before typechecking the API.
- **Git pre-commit hook** runs `pnpm exec lint-staged`; prefix commits with the Corepack shim: `PATH="$HOME/.corepack-shims:$PATH" git commit ...`.
- **Migrations** are generated offline: `corepack pnpm --filter @fides/api exec drizzle-kit generate --name <name>` (latest: `0006_sca-step-up`). New env vars are documented in `.env.example` (WebAuthn, session TTLs, CORS, throttle/scheduler switches and intervals).
- **Repo is PUBLIC** (`LorenzoCianfe/fides`); Dependabot tuned on `main`; framework majors deferred to Phase 7.
- **Commit cadence:** per-slice conventional commits on `phase-1-walking-skeleton`; one PR at Phase 1 completion.

## 7. How to verify

```bash
# with Docker running:
corepack pnpm --filter @fides/contracts build   # if contracts changed
corepack pnpm --filter @fides/api test          # 95 tests (Testcontainers Postgres)
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
- Redis is still unused (sessions/challenges/idempotency are Postgres-backed; any Redis fast-path must preserve immediate revocation, ADR-0020).
- Device metadata is client-declared and untrusted until mobile attestation (Slice 8).
- WebAuthn **server-issued options schemas** in contracts are documentation-shaped (responses are not runtime-validated); client-submitted payloads are validated with `.passthrough()`.
- `kyc.approved` events accumulate as `pending` until the Slice 4 handler registers — intended (they are the provisioning queue), but the first dispatch after Slice 4 lands will process the whole backlog.
