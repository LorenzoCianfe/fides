# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
