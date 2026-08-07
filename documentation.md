# Fides — Platform Documentation

> Product name `Fides` is the selected name, defined as a single configurable value (`APP_NAME`), and remains subject to EUIPO trademark and domain clearance. It can be replaced project-wide without architectural impact.

| Field | Value |
|---|---|
| Document | Master platform documentation |
| Version | 0.14.0 |
| Status | Phase 1 (Walking skeleton) complete — remediation in progress |
| Scope | Simulated-core EU neobank (iOS, Android, web) + admin back office |
| Last updated | 2026-08-07 |

---

## 1. Purpose

This document is the primary, evolving record of the platform. It tracks architecture decisions, implemented features, technical rationale, and the system's evolution across versions. It is maintained as code (in-repository, updated per change) and is authoritative for how the system is structured. Companion documents: [roadmap.md](roadmap.md), [design.md](design.md), [security.md](security.md). Phase 1 build progress and the session-to-session continuation state are tracked in [docs/phase-1-handoff.md](docs/phase-1-handoff.md).

## 2. Product overview

Fides is a production-grade digital neobank for the European market, delivered as three client applications (native iOS, native Android, responsive web) plus a dedicated internal admin back office.

The platform is built as a **simulated core**: it implements a genuine double-entry ledger and full product logic, while all external financial rails (payment schemes, card issuing/processing, identity verification, market data) are mocked behind stable interfaces. The system is architected so that a Banking-as-a-Service (BaaS) provider can later replace those mocks without reworking the domain. This "design-for-BaaS" constraint is a first-class architectural principle, not an afterthought.

### 2.1 In scope

- Retail money management for EU natural persons: consumers, savers, and freelancers/sole traders.
- EUR-based accounts with multi-currency wallets and in-app FX (simulated rates).
- Payment cards: virtual and physical debit, with rich controls; card lifecycle management.
- Payments: SEPA Credit Transfer (inbound/outbound), SEPA Instant, internal instant P2P, SEPA Direct Debit, and standing orders.
- Savings: interest-bearing vaults/pockets and goals.
- Investing: a simulated stocks/ETF brokerage experience on mock market data.
- Insights: transaction categorization, budgets and goals, recurring/subscription detection, and cash-flow forecasting.
- Admin back office: user/account administration, card operations, case and investigation management, financial operations, oversight dashboards, support console, user communications, and compliance reporting.

### 2.2 Out of scope (current)

- Real movement of customer funds; live payment-scheme or card-network connectivity.
- Any regulated activity requiring a licence (the platform is not a licensed institution).
- Business accounts and KYB onboarding (not precluded architecturally; deferred).
- Credit/charge card products and lending.
- Real securities execution, custody, or MiFID II-regulated investment services.
- AI/ML-based insights and scoring (rules-based only for now).

## 3. Architecture

### 3.1 Principles

1. **Design-for-BaaS (ports and adapters).** Every external capability is expressed as a domain-facing port with a mock adapter today and a provider adapter later. The domain never depends on an external SDK directly.
2. **Correctness first.** Money is modelled with a double-entry ledger and integer-precise value objects. Financial invariants are enforced and tested, not assumed.
3. **Modular monolith.** A single deployable backend, internally decomposed into strict domain modules with explicit boundaries. Decomposition into services is possible later but not adopted prematurely.
4. **Security and auditability by design.** Least privilege, immutable audit trails, and defence in depth apply across all tiers. See [security.md](security.md).
5. **One language, shared contracts.** TypeScript across backend, web, mobile, and admin, with shared domain types and validation schemas to eliminate drift.

### 3.2 System context

```
        +-----------+   +-----------+   +-----------+
        |   iOS /   |   |    Web    |   |   Admin   |
        |  Android  |   |  (Next.js)|   | (Next.js) |
        | (RN/Expo) |   |           |   |           |
        +-----+-----+   +-----+-----+   +-----+-----+
              |               |               |
              +-------- HTTPS / REST + OpenAPI --------+
                              |
                     +--------v---------+
                     |   API (NestJS)   |  modular monolith
                     |  domain modules  |
                     +--------+---------+
                              |
        +---------------------+----------------------+
        |            |               |               |
   +----v---+  +-----v----+   +------v-----+   +-----v-----+
   |Postgres|  |  Redis    |   | Object     |   | External  |
   |(ledger,|  | (cache,   |   | storage    |   | ports     |
   | events)|  | sessions) |   | (S3-compat)|   | (MOCKED)  |
   +--------+  +-----------+   +------------+   +-----------+
                                                     |
                              SEPA rails | card issuer | KYC/AML | market data
```

### 3.3 Domain modules

Each module is hexagonal: a domain core, application services, inbound adapters (HTTP), and outbound adapters (persistence, external ports).

| Module | Responsibility | External ports |
|---|---|---|
| identity | Registration, authentication, passkeys, sessions, SCA, devices | — |
| kyc | Onboarding verification pipeline, screening, risk decision | KYC/liveness/screening |
| accounts | Accounts and multi-currency wallets, account lifecycle | — |
| ledger | Double-entry journal, postings, balances (system of record) | — |
| payments | SEPA SCT/Instant, P2P, direct debits, standing orders | SEPA rails |
| cards | Virtual/physical debit, controls, lifecycle, 3DS/SCA | Card issuer/processor |
| fx | Currency exchange, quoting, rate application | Market data (rates) |
| savings | Vaults/pockets, goals, interest accrual | — |
| investing | Instruments, watchlists, orders, positions, portfolio (simulated) | Market data |
| insights | Categorization, budgets, goals, recurring detection, forecasting | — |
| risk | Rules-based transaction monitoring, scoring, case creation | — |
| notifications | Push, email, in-app messages | Push/email delivery |
| admin | Back-office operations, RBAC, four-eyes workflows | — |
| audit | Immutable audit trail for sensitive and admin actions | — |

### 3.4 Data and ledger model

- **PostgreSQL** is the system of record.
- The **ledger** is an append-only, double-entry structure: `ledger_accounts`, `journal_entries`, and `postings`. Every economic event produces a balanced entry whose postings sum to zero per currency. Balances are derived (and cached as read models), never mutated in place.
- A **domain event log / transactional outbox** captures state changes for auditability, projections, and eventual integration. Read models (balances, transaction history, analytics) are projected from these events.
- **Redis** provides caching, session storage, rate limiting, and idempotency keys.
- **Object storage** (S3-compatible) holds documents (KYC artefacts, statements), encrypted at rest.

### 3.5 Money representation

- Monetary amounts are stored as **integer minor units** (e.g. cents) with an explicit currency, never as floating-point numbers.
- A currency-aware `Money` value object encapsulates arithmetic, currency safety, and rounding.
- FX and interest use `NUMERIC` for intermediate precision, with explicit, documented rounding rules and full test coverage.

## 4. Technology stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict) |
| Backend framework | NestJS |
| Web | Next.js (React) |
| Mobile | React Native (Expo) |
| Admin | Next.js (separate app) |
| Database | PostgreSQL |
| Cache / sessions | Redis |
| Object storage | S3-compatible |
| Validation | Zod (shared schemas) |
| DB access | Drizzle ORM + drizzle-kit (ADR-0017) |
| API contract | OpenAPI generated from Zod (nestjs-zod + zod-to-openapi) |
| Testing | Vitest (all tiers) |
| Monorepo | pnpm workspaces + Turborepo |
| Local runtime | Docker Compose |
| CI | GitHub Actions with security gates |

## 5. Repository structure (target)

```
apps/
  api/          NestJS backend (modular monolith)
  web/          Next.js customer web app
  admin/        Next.js admin back office
  mobile/       React Native (Expo) app
packages/
  domain/       shared domain types, Money value object, enums
  contracts/    Zod schemas, DTOs, generated API types
  ui-tokens/    design tokens (shared source of truth)
  ui-web/       web component library (Tailwind + shadcn/Radix)
  ui-mobile/    React Native component library
  config/       shared eslint, tsconfig, build config
docs/
  adr/          architecture decision records
infra/
  docker/       Dockerfiles, docker-compose
.github/
  workflows/    CI pipelines
documentation.md  roadmap.md  design.md  security.md
```

## 6. Cross-cutting concerns

- **Authentication/authorization:** passkeys-first identity, step-up SCA, and RBAC. See [security.md](security.md).
- **Audit:** every sensitive and administrative action is recorded in an immutable, tamper-evident trail.
- **Error model:** a single typed error taxonomy shared across tiers; no silent failures.
- **Idempotency:** all money-moving operations require idempotency keys.
- **Internationalization:** copy externalized; locale-aware money/date formatting from the start.
- **Configuration:** 12-factor; secrets never in code; environment-driven.

## 7. External integrations (ports and adapters)

| Capability | Port | Mock adapter (now) | Candidate provider (later) |
|---|---|---|---|
| SEPA payments | `PaymentRailPort` | In-memory scheme simulator | BaaS (Swan, Solaris) |
| Card issuing | `CardIssuerPort` | Simulated issuer/processor | Marqeta, Enfuce, BaaS |
| Identity verification | `KycPort` | Scripted verification/liveness | Onfido, Sumsub |
| Sanctions/PEP screening | `ScreeningPort` | Static list matcher | ComplyAdvantage |
| Market data | `MarketDataPort` | Synthetic price feed | Licensed market-data vendor |
| Push/email | `NotificationPort` | Console/log + local capture | APNs/FCM, email ESP |

## 8. Architecture decision records

ADRs are maintained under `docs/adr/` (see the [index](docs/adr/README.md)). The decisions accepted during discovery were written up as the initial records in Phase 0; ADR-0017 (ORM) was resolved to Drizzle and ADR-0018 (money representation and rounding) was added.

| ADR | Decision | Status |
|---|---|---|
| 0001 | Simulated core with hexagonal ports/adapters (design-for-BaaS) | Accepted |
| 0002 | EU/EEA regulatory frame: PSD2/SCA, GDPR, EMI semantics | Accepted |
| 0003 | TypeScript + NestJS backend | Accepted |
| 0004 | Modular monolith in a pnpm/Turborepo monorepo | Accepted |
| 0005 | PostgreSQL + append-only double-entry ledger + event/outbox | Accepted |
| 0006 | Next.js web and admin; React Native (Expo) mobile | Accepted |
| 0007 | Passkeys-first, self-managed identity with step-up SCA | Accepted |
| 0008 | Full simulated KYC/AML onboarding pipeline | Accepted |
| 0009 | Rules-based transaction monitoring engine | Accepted |
| 0010 | Full data-protection posture; minimized PCI scope | Accepted |
| 0011 | Admin RBAC with segregation of duties and four-eyes | Accepted |
| 0012 | Local-first environments; EU cloud later | Accepted |
| 0013 | Full CI with security gates | Accepted |
| 0014 | Ledger-focused testing strategy | Accepted |
| 0015 | Docs-as-code with ADRs and OpenAPI | Accepted |
| 0016 | Minimal, trustworthy design language; shared tokens | Accepted |
| 0017 | ORM selection: Drizzle | Accepted |
| 0018 | Money representation and rounding policy | Accepted |
| 0019 | Synchronous in-transaction balance projection (refines 0005) | Accepted |
| 0020 | Opaque server-side session tokens and WebAuthn ceremony policy (refines 0007) | Accepted |
| 0021 | HTTP auth surface: token transport, SCA dynamic linking, throttling, retention (refines 0007, 0020) | Accepted |
| 0022 | Account provisioning and the account/wallet/ledger-account model (refines 0005, 0019) | Accepted |
| 0023 | Internal P2P transfer: SCA enforcement, dev funding, and the transaction-history read (refines 0019, 0021, 0022) | Accepted |
| 0024 | Append-only, hash-chained audit trail (refines 0005, 0019, 0021) | Accepted |
| 0025 | Admin identity, RBAC, MFA, and four-eyes on admin funding (refines 0011) | Accepted |
| 0026 | Dependency audit remediation: scoped transitive overrides and the brace-expansion patch (refines 0013) | Accepted |
| 0027 | Client token transport, CSRF defence, security headers, and native app association (refines 0020, 0021) | Accepted |
| 0028 | Field-level encryption: a KMS-shaped keyring, applied first to admin TOTP secrets (refines 0010, 0025) | Accepted |
| 0029 | Per-account admin lockout and auditing denied attempts (refines 0024, 0025) | Accepted |
| 0030 | Admin credential rotation and four-eyes second-factor reset (refines 0011, 0025, 0029) | Accepted |

## 9. Versioning and change log

The platform follows semantic versioning. This document's version tracks documentation revisions, not code releases; release notes will be maintained in `CHANGELOG.md` from Phase 0.

| Version | Date | Change |
|---|---|---|
| 0.1.0 | 2026-07-04 | Initial documentation from discovery; scope, architecture, stack, and ADR index established. |
| 0.2.0 | 2026-07-04 | Phase 0 foundations implemented. ADR-0017 resolved (Drizzle); ADR-0018 added (money/rounding). Stack finalized: Vitest, Zod-first OpenAPI. ADRs 0001–0018 written; CHANGELOG initiated. |
| 0.3.0 | 2026-07-05 | Phase 1 ledger persistence: double-entry schema, append-only triggers, transactional posting service with idempotency and outbox, and a synchronously-maintained balance projection. ADR-0019 added (balance projection strategy). |
| 0.4.0 | 2026-07-05 | Phase 1 progress: async transaction-history projection via the outbox dispatcher (Slice 2 complete); identity onboarding foundation (Slice 3 Wave A) — registration, email verification, and a mock KYC pipeline. Continuation state captured in [docs/phase-1-handoff.md](docs/phase-1-handoff.md). |
| 0.5.0 | 2026-07-06 | Phase 1 Slice 3 Wave B: WebAuthn relying party (passkey registration and email-first authentication, UV required, anti-enumeration decoys) and server-side sessions (opaque hashed tokens, rotation with reuse detection, immediate revocation), enrolment-token-gated first passkey, auth guard and ownership helper. ADR-0020 added. |
| 0.6.0 | 2026-07-06 | Phase 1 Slice 3 Wave C: the `/v1/auth` HTTP surface (registration, email-keyed verification and resend, WebAuthn ceremonies, session refresh/logout/list/revoke) with Zod contracts and generated OpenAPI; SCA step-up seam with PSD2 dynamic linking (action-hashed challenges, single-use grants); auth rate limiting; correlation-id middleware, CORS, and `/v1` versioning; scheduled outbox dispatch and retention sweeper. ADR-0021 added. Slice 3 complete. |
| 0.7.0 | 2026-07-12 | Phase 1 Slice 4: accounts & wallets. Event-driven, idempotent account provisioning consumes `kyc.approved` inside the outbox dispatcher's transaction, creating one EUR account + a single wallet + a backing ledger account (`wallet:<walletId>`, liability). Account read surface (`GET /v1/accounts`, `GET /v1/accounts/{accountId}`) with live balances read from the authoritative ledger projection (ADR-0019), session-guarded and ownership-scoped. ADR-0022 added. |
| 0.8.0 | 2026-07-12 | Phase 1 Slice 5: internal instant P2P transfer + dev funding. `POST /v1/transfers` — idempotent, SCA-gated transfer with PSD2 dynamic linking enforced inside the posting transaction (action hash recomputed from the executed amount/payee; single-use grant consumed via a new `onClaimed` hook so it fires exactly once and replays skip it). Kill-switched dev funding faucet (`POST /v1/dev/funding`) and a keyset-paginated, ownership-scoped wallet transaction history (`GET /v1/wallets/{walletId}/transactions`). Proves the Phase 1 exit criteria end to end (115 tests). ADR-0023 added. |
| 0.9.0 | 2026-07-13 | Phase 1 Slice 6: append-only, hash-chained audit trail. A new `audit` module records sensitive actions (P2P transfer, dev funding, SCA step-up, session revocation and refresh-reuse revocation, account provisioning) to an immutable `audit_log` (migration `0008`) inside each action's own transaction — a money move via a new symmetric `onPosted` hook on the posting path. One global hash chain (`sha256(prev_hash + canonical(record))`, gap-free `seq`, advisory-lock append) whose integrity a pure `verifyAuditChain` confirms; the ledger's append-only triggers reject UPDATE/DELETE, so tampering breaks the chain. Records hold internal references only (no raw PII). Dead-session retention tightened to prompt purge now that the forensic record lives in the trail; the SCA-grant→session FK became `ON DELETE CASCADE` (migration `0009`). ADR-0024 added. 129 tests. |
| 0.14.0 | 2026-08-07 | Phase 1 remediation, Slice 10 Wave B: admin credential rotation and recovery (ADR-0030). Closes the last ADR-0025 credential gap. An operator can rotate their own password at `POST /v1/admin/me/password`, re-proving **both** factors — the current password and a fresh TOTP code that advances the same replay guard sign-in advances, so it cannot be spent twice — and the rotation revokes every other session they hold, sparing the calling one. A lost second factor is recovered through **four-eyes** rather than a database edit: `admin_totp_reset` becomes the second registered `pending_admin_actions` type, which the deliberately generic table absorbed **without a migration**. Its maker half is narrower than funding's (compliance officer only), because funding credits a customer within a cap while a reset hands over a back-office identity. Approval clears the secret, enrolment, replay guard, and lockout and revokes the target's sessions, in the transaction that decides the request; no admin may approve a reset of their own factor, which `checkerId != makerId` does not cover. Decisions moved to type-scoped routes (`/v1/admin/funding-requests/{id}/approve|reject`, `/v1/admin/totp-resets/{id}/approve|reject`) so the permission each needs stays on the route; `/v1/admin/pending-actions` remains the unified read. 309 tests. |
| 0.13.0 | 2026-08-06 | Phase 1 remediation, Slices 9 and 10 Wave A (recorded here retrospectively; both landed on `main` without a row). **Slice 9 — dependency hygiene (ADR-0026 second addendum):** the last standing audit suppression is retired now that `lodash@4.18.x` has actually shipped, closed by a range-scoped override rather than a suppression, with `pnpm.auditConfig` removed and the gate reporting zero high-severity findings; the `brace-expansion` patch's exit condition is corrected from the Expo toolchain to the React Native major that really pins it. **Slice 10 Wave A — admin credential hardening (ADR-0028, ADR-0029):** field-level encryption arrives as a KMS-shaped `EncryptionPort` with an AES-256-GCM keyring, applied first to admin TOTP secrets — the one secret that cannot be hashed — with self-describing envelopes so rotation is configuration rather than a migration, and the admin id as additional authenticated data so a ciphertext cannot be grafted onto another operator's row; and per-account lockout counts both factors against one counter while denied attempts are audited, written in their own transaction because the TOTP step deliberately rolls its own back. Migration `0012`. ADRs 0028 and 0029 added to §8. 288 tests. |
| 0.12.0 | 2026-08-06 | Phase 1 Slice 8 Waves B–D: the clients, and Phase 1 complete. A Next.js **web client** on the ADR-0027 cookie transport covering the exit-criteria journey in English and Italian, and an Expo **mobile client** with native passkeys on the bearer transport, holding its token pair in the platform keystore. A new `@fides/i18n` package carries the message catalogue, locale negotiation, and the `BigInt`-exact money formatting both clients share, so the two cannot drift. Mobile's refresh path is single-flighted, because concurrent refreshes would trip the rotation reuse detection and revoke a legitimate session. A **Playwright end-to-end suite** (`apps/e2e`, its own CI job) drives the built API and web app against a real Postgres through a real browser, with genuine WebAuthn ceremonies on the CDP virtual authenticator, four-eyes admin funding, and the SCA-gated transfer — and on its first complete run it found a real defect: the CSRF cookie was scoped to `/v1`, making it unreadable by a client served from `/`, so every state-changing request in cookie mode failed. Corrected to `Path=/` with the path now asserted; see the ADR-0027 addendum. |
| 0.11.0 | 2026-07-29 | Phase 1 Slice 8 Wave A: client token transport and web hardening (ADR-0027). An opt-in, per-request httpOnly-cookie transport closes the XSS gap ADR-0021 deferred to this slice — tokens withheld from the body, `SameSite=Strict`, the refresh cookie scoped to the one route that spends it, and a double-submit CSRF token hashed onto the session row (migration `0011`), enforced by the guard and, for refresh, inside the rotation transaction. Bearer callers are exempt and wholly unchanged, so mobile and web share one API and one contract. Adds helmet security headers (two-year HSTS with preload; `default-src 'none'` on the JSON surface with the Swagger relaxation confined to `/docs`), credentialed CORS, and the native passkey app-association documents served from the API so they follow whichever origin fronts it. 260 tests. |
| 0.10.1 | 2026-07-29 | Dependency audit remediation ahead of Slice 8 (ADR-0026). The blocking `pnpm audit --prod --audit-level=high` gate, red on `main` from three weeks of advisory drift against the Phase 0 client shells, is green again: `next` moved to `^15.5.22` within its pinned major, and `postcss`, `sharp`, and `js-yaml` were closed with version-range-scoped `pnpm` overrides. `brace-expansion` was forced to `5.0.8` — the only version clearing its out-of-memory advisory — and patched to restore the callable default export that `minimatch@3`, `@5`, and `@9` require. No new audit suppression was added. |
| 0.10.0 | 2026-07-28 | Phase 1 Slice 7: admin RBAC, MFA, and four-eyes. A new `admin` module (migration `0010`) gives the back office a separate `admins` identity — its own guard, principal, session table, and token prefix, sharing no table or code path with customer authentication. Two-step login: a password yields only a single-use challenge, and the session is issued solely after an RFC 6238 TOTP code verifies (scrypt passwords, an in-house TOTP tested against the RFC vectors, a strictly-increasing accepted step so codes cannot be replayed). Sessions are one opaque token with a 30-minute sliding idle window and an 8-hour absolute cap. Authorization runs through a code-defined role→permission matrix behind `@RequirePermission`, with segregation of duties made structural: `super_admin` is deliberately denied the funding *request* permission, so no role holds both halves, and a test asserts it. Four-eyes is proven end to end on admin funding — the credit posts inside the same transaction that decides the request. Read-only views cover customers, wallet history, ledger reconciliation, and the audit read/verify surface deferred from Slice 6. The Slice 5 dev funding faucet is retired. ADR-0025 added. 219 tests. |

## 10. Glossary

- **BaaS** — Banking-as-a-Service; a licensed provider supplying regulated banking rails via API.
- **SCA** — Strong Customer Authentication (PSD2); two independent authentication factors.
- **SEPA / SCT / SCT Inst** — Single Euro Payments Area; Credit Transfer; Instant Credit Transfer.
- **SDD** — SEPA Direct Debit.
- **EMI** — Electronic Money Institution.
- **KYC / AML** — Know Your Customer / Anti-Money-Laundering.
- **PEP** — Politically Exposed Person.
- **Ledger posting** — a single debit or credit line within a balanced journal entry.
