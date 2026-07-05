# Fides — Platform Documentation

> Product name `Fides` is the selected name, defined as a single configurable value (`APP_NAME`), and remains subject to EUIPO trademark and domain clearance. It can be replaced project-wide without architectural impact.

| Field | Value |
|---|---|
| Document | Master platform documentation |
| Version | 0.4.0 |
| Status | Phase 1 (Walking skeleton) — in progress |
| Scope | Simulated-core EU neobank (iOS, Android, web) + admin back office |
| Last updated | 2026-07-05 |

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

## 9. Versioning and change log

The platform follows semantic versioning. This document's version tracks documentation revisions, not code releases; release notes will be maintained in `CHANGELOG.md` from Phase 0.

| Version | Date | Change |
|---|---|---|
| 0.1.0 | 2026-07-04 | Initial documentation from discovery; scope, architecture, stack, and ADR index established. |
| 0.2.0 | 2026-07-04 | Phase 0 foundations implemented. ADR-0017 resolved (Drizzle); ADR-0018 added (money/rounding). Stack finalized: Vitest, Zod-first OpenAPI. ADRs 0001–0018 written; CHANGELOG initiated. |
| 0.3.0 | 2026-07-05 | Phase 1 ledger persistence: double-entry schema, append-only triggers, transactional posting service with idempotency and outbox, and a synchronously-maintained balance projection. ADR-0019 added (balance projection strategy). |
| 0.4.0 | 2026-07-05 | Phase 1 progress: async transaction-history projection via the outbox dispatcher (Slice 2 complete); identity onboarding foundation (Slice 3 Wave A) — registration, email verification, and a mock KYC pipeline. Continuation state captured in [docs/phase-1-handoff.md](docs/phase-1-handoff.md). |

## 10. Glossary

- **BaaS** — Banking-as-a-Service; a licensed provider supplying regulated banking rails via API.
- **SCA** — Strong Customer Authentication (PSD2); two independent authentication factors.
- **SEPA / SCT / SCT Inst** — Single Euro Payments Area; Credit Transfer; Instant Credit Transfer.
- **SDD** — SEPA Direct Debit.
- **EMI** — Electronic Money Institution.
- **KYC / AML** — Know Your Customer / Anti-Money-Laundering.
- **PEP** — Politically Exposed Person.
- **Ledger posting** — a single debit or credit line within a balanced journal entry.
