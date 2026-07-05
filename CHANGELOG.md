# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Phase 1 — Walking skeleton (in progress).** Ledger domain core: account taxonomy with normal-balance rules, positive-amount postings, and a balanced-by-construction `JournalEntry` builder (debits equal credits per currency), covered by example and property-based (`fast-check`) invariant tests.
- Ledger persistence: `ledger_accounts`, `journal_entries`, `postings`, a synchronously-maintained `balances` projection (ADR-0019), and a per-actor `idempotency_keys` table. A migration installs database triggers that forbid UPDATE/DELETE on the append-only ledger tables.
- Transactional posting service: posts a balanced entry, updates the balance projection under a deterministic row lock, enforces non-negative wallet balances, claims the idempotency key, and enqueues a `ledger.entry.posted` outbox event — all in one transaction. Read-side reconciliation (projection equals the sum of postings) and a whole-ledger zero-sum check.
- Testcontainers-backed integration tests running under `pnpm test` against an ephemeral Postgres with the committed migrations applied.

- **Phase 0 — Foundations.** Monorepo scaffolding (pnpm workspaces + Turborepo), strict TypeScript, ESLint (flat config) + Prettier, and a shared `@fides/config` package.
- Shared kernel `@fides/domain`: currency-safe `Money` value object (integer minor units, float-free rounding), currency registry, typed error taxonomy, and event/outbox primitives — unit-tested with Vitest (53 tests).
- `@fides/contracts`: Zod-first schemas as the single source of truth, with `zod-to-openapi` document generation.
- Design system: `@fides/ui-tokens` (semantic light/dark tokens, tabular figures), `@fides/ui-web` (Tailwind + React seed), and `@fides/ui-mobile` (React Native seed).
- `apps/api`: NestJS modular-monolith skeleton with Zod-validated environment, Drizzle + `postgres-js`, a transactional `outbox` table and migration, a global domain exception filter, a `/health` endpoint, and Zod-first OpenAPI served at `/docs`.
- `apps/web` and `apps/admin`: Next.js 15 shells consuming the design tokens and component library, with token-generated light/dark themes.
- `apps/mobile`: Expo (React Native) shell consuming the shared tokens.
- Local stack: Docker Compose for Postgres, Redis, and MinIO, booting via `pnpm stack:up`.
- CI: GitHub Actions (lint, typecheck, test, build) with dependency audit, gitleaks secret scanning, and CodeQL SAST; Dependabot; a husky pre-commit hook.
- Architecture Decision Records ADR-0001 through ADR-0018.

### Security

- Upgraded `drizzle-orm` to >= 0.45.2 to resolve a SQL-injection advisory (GHSA-gpj5-g38j-94v9) in the ledger ORM.
- Pinned patched transitive dependencies via pnpm overrides: `multer` >= 2.1.0 (DoS) and `glob` >= 10.5.0 (CLI command injection).
- CI secret scanning runs gitleaks against the working tree for deterministic results; one unfixable transitive advisory (lodash `_.template`, no published fix) is explicitly ignored with justification.
