# Fides — Delivery Roadmap

| Field | Value |
|---|---|
| Document | Product and engineering roadmap |
| Version | 0.2.0 |
| Status | Living — Phases 0 and 1 complete; Phase 1 remediation in progress |
| Delivery model | Solo + Claude Code, phased |
| Last updated | 2026-08-07 |

---

## 1. Delivery approach

Development proceeds in sequential phases. Each phase has a clear objective, a bounded scope, defined deliverables, and explicit exit criteria that must be met before the next phase begins. The guiding strategy is a **walking skeleton first**: a thin, end-to-end vertical slice through every tier is built before breadth is added, so integration risk is retired early and every later feature lands on proven foundations.

Principles:

- **Vertical over horizontal.** Deliver complete user-visible flows across backend, clients, and admin, not isolated layers.
- **Correctness gates.** No phase is complete while ledger invariants or money-path tests are failing.
- **BaaS seams from day one.** External capabilities are introduced as ports with mock adapters, never as direct dependencies.
- **Security is in-phase, not post-phase.** Controls relevant to a feature ship with that feature.

## 2. Milestone overview

| Phase | Title | Objective | Primary outcome |
|---|---|---|---|
| 0 | Foundations | Repo, tooling, CI, shared kernel | Buildable, tested skeleton |
| 1 | Walking skeleton | Identity → account → ledger → transfer | One transfer, end to end |
| 2 | Payments & cards | SEPA + virtual cards | Spend and move money |
| 3 | Compliance core | KYC/AML + monitoring + cases | Onboarding and controls |
| 4 | Money features | Multi-currency, FX, savings, mandates | Full money layer |
| 5 | Investing | Simulated brokerage | Investing tab |
| 6 | Insights | Analytics and budgeting | Financial insights |
| 7 | Hardening & readiness | Physical cards, reporting, deploy readiness | Release candidate |

## 3. Phases

### Phase 0 — Foundations

**Objective.** Establish the monorepo, tooling, and shared kernel so that all later work is fast, typed, and tested.

**Scope.**
- Monorepo (pnpm + Turborepo); `apps/` and `packages/` scaffolding.
- Backend (NestJS) and client shells (Next.js web, Next.js admin, Expo mobile) that build and run.
- Docker Compose (Postgres, Redis, object storage) for local development.
- Shared kernel: `Money` value object, currency registry, typed error taxonomy, event/outbox primitives.
- Design tokens package; base component libraries seeded.
- CI (GitHub Actions): lint, typecheck, test, build, dependency audit, secret scan, SAST.
- ADR-0001 through ADR-0017 written; `CHANGELOG.md` initiated.

**Exit criteria.** CI green on an empty-but-wired system; `Money` and ledger primitives unit-tested; local stack boots via a single command.

### Phase 1 — Walking skeleton

**Objective.** Prove the full vertical: a registered user with an account and a real ledger can make one transfer, visible on all clients.

**Scope.**
- Identity: registration, passkey enrolment/login, session management, device binding, SCA scaffolding.
- Basic onboarding (identity data capture; KYC stubbed as a pending state).
- One EUR account with a single wallet.
- Double-entry ledger: accounts, journal entries, postings, derived balances.
- Internal instant P2P transfer between two users, idempotent and fully audited.
- Balance and transaction history on web and mobile.
- Admin: read-only user/account and ledger views.

**Exit criteria.** A transfer moves value between two users with a balanced journal entry; balances reconcile; the flow is covered by integration and ledger-invariant tests; the action appears in the audit trail.

**Status: complete** (2026-08-06), across eight build slices. The exit criteria are proven end to end by the Playwright suite, which drives the built API and web client through real WebAuthn ceremonies and the SCA-gated transfer.

#### Phase 1 remediation

Four slices close gaps the build slices recorded rather than solved. They run before Phase 2 because each is a correctness or security debt against work already merged, and none of them grows in value by waiting. Slice-level detail lives in [docs/phase-1-handoff.md](docs/phase-1-handoff.md).

| Slice | Scope | Status |
|---|---|---|
| 9 | Dependency hygiene: retire the last audit suppression; correct the `brace-expansion` exit condition | Done — ADR-0026 addenda |
| 10 A | Encrypt admin TOTP secrets; per-account lockout; audit denied attempts | Done — ADR-0028, ADR-0029 |
| 10 B | Admin password rotation; four-eyes second-factor reset | Done — ADR-0030 |
| 11 | Audit tail-truncation anchoring, closing the ADR-0024 deferral | Done — ADR-0031 |
| 12 | Five missing end-to-end cases; an automated accessibility gate on every PR | Pending |

Slice 12's automated gate (`axe-core` in the Playwright suite, enforcing contrast, labels, roles, and landmarks) is deliberately **not** the WCAG 2.2 AA audit below: that stays in Phase 7. It is the middle path that honours `design.md`'s "accessibility is not a later pass" without pulling a manual audit forward.

### Phase 2 — Payments & cards

**Objective.** Enable spending and external money movement (simulated).

**Scope.**
- SEPA Credit Transfer (inbound/outbound) and SEPA Instant via the mock `PaymentRailPort`.
- IBAN assignment; payee management, including public payment handles (`@tag`) for P2P recipients (email is the Phase 1 identifier; ADR-0023).
- Virtual debit card issuance via the mock `CardIssuerPort`; authorization/settlement simulation against the ledger.
- Card controls: limits, freeze/unfreeze, category and channel toggles; 3DS/SCA on sensitive card actions.
- Admin: user/account administration and card operations.

**Exit criteria.** A user can receive a SEPA credit, spend on a virtual card, and see correct ledger effects; an admin can freeze a card and restrict an account; four-eyes enforced on high-risk admin actions.

### Phase 3 — Compliance core

**Objective.** Make onboarding and ongoing monitoring realistic and operable.

**Scope.**
- Full simulated KYC/AML pipeline: document capture, liveness step, sanctions/PEP screening, risk scoring, and decisioning — behind mock adapters.
- Rules-based transaction monitoring: velocity/amount limits, geo/anomaly rules, blocklists, and risk scoring.
- Admin case and investigation management: queues, triage, notes, evidence, escalation.
- Segregation of duties and four-eyes workflows formalized across sensitive operations.

**Exit criteria.** A new user completes (or fails) a modelled KYC flow; monitoring flags a scripted suspicious pattern into a case; an analyst investigates and an officer approves an action under four-eyes.

### Phase 4 — Money features

**Objective.** Complete the core money layer.

**Scope.**
- Multi-currency wallets and in-app FX (simulated rates) with explicit quoting and rounding.
- Savings vaults/pockets and goals; interest accrual with tested rounding.
- SEPA Direct Debit (mandates) and standing orders (scheduled transfers).

**Exit criteria.** A user holds and exchanges multiple currencies, funds a savings goal that accrues interest, and sets up a standing order and a direct-debit mandate; all effects are ledger-correct.

### Phase 5 — Investing (simulated)

**Objective.** Deliver a Trade Republic-style investing experience on mock data.

**Scope.**
- Instrument catalogue (stocks/ETFs); watchlists.
- Simulated order placement, positions, and portfolio valuation via `MarketDataPort`.
- Investing views on web and mobile.

**Exit criteria.** A user builds a watchlist, places a simulated order, and sees positions and portfolio value update against the synthetic feed; no real execution occurs.

### Phase 6 — Insights

**Objective.** Turn transaction data into financial understanding.

**Scope.**
- Transaction categorization; spend-by-category and monthly views.
- Budgets and savings goals with progress tracking.
- Recurring/subscription detection and cash-flow forecasting.

**Exit criteria.** A user sees categorized spending, sets a budget, and receives a forecast and recurring-payment summary derived from their history.

### Phase 7 — Hardening & release readiness

**Objective.** Bring the platform to a demonstrable release candidate.

**Scope.**
- Physical card lifecycle (order, ship, activate) via the mock issuer.
- Compliance reporting and audit exports; oversight dashboards.
- Internationalization coverage; WCAG 2.2 AA accessibility audit and remediation.
- Performance, resilience, and security hardening; threat-model review.
- EU-region cloud deployment readiness (configuration, managed Postgres, observability).

**Exit criteria.** End-to-end demo across all clients and admin; security and accessibility audits passed; deployment runbook validated.

## 4. Prioritization and sequencing notes

- Phases 0–3 are foundational and strictly ordered. Phases 4–6 are largely independent and may be re-ordered by preference; the sequence above front-loads the most broadly used features.
- Investing (Phase 5) is intentionally after the core money layer, as it depends on wallets and the ledger but not on payments breadth.
- Insights (Phase 6) benefits from real transaction volume, so it follows the features that generate it.

## 5. Risks and dependencies

| Risk | Mitigation |
|---|---|
| Solo bandwidth vs. broad scope | Strict phasing; walking skeleton; ruthless deferral of non-essential breadth. |
| Ledger correctness defects | Property/invariant tests; adapter contract tests; no float arithmetic. |
| Mock/real divergence at BaaS time | Ports defined against realistic provider semantics; contract tests per adapter. |
| Scope creep from "later" items | Explicit out-of-scope register in [documentation.md](documentation.md). |

## 6. Deferred (explicitly later)

Business/KYB accounts; credit/charge cards and lending; real securities/MiFID II; crypto (MiCA); AI/ML insights and scoring; production licensing and live rails.

## 7. Change log

| Version | Date | Change |
|---|---|---|
| 0.2.0 | 2026-08-07 | Records delivery against the plan for the first time. Phases 0 and 1 are complete; Phase 1 gained a **remediation track** (Slices 9–12) that runs before Phase 2, because each of its items is a security or correctness debt against merged work and none improves by waiting. Slices 9, 10 A, and 10 B are done. Notes that Slice 12's automated accessibility gate is not the Phase 7 WCAG 2.2 AA audit and does not replace it. |
| 0.1.0 | 2026-07-04 | Initial roadmap; phases 0–7 defined with objectives and exit criteria. |
