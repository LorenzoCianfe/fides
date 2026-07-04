# Fides

Simulated-core EU neobank — a modular-monolith backend, three client apps (web, admin, mobile), and a genuine double-entry ledger. External financial rails (SEPA, card issuing, KYC/AML, market data) are mocked behind stable ports so a Banking-as-a-Service provider can replace them later without reworking the domain.

> `Fides` is the working product name (`APP_NAME`), subject to trademark/domain clearance. It is a single configurable value and can be changed project-wide without architectural impact.

## Documentation

| Document | Purpose |
|---|---|
| [documentation.md](documentation.md) | Master platform documentation — architecture, features, decisions |
| [roadmap.md](roadmap.md) | Phased delivery plan and exit criteria |
| [design.md](design.md) | UX, UI, and system design |
| [security.md](security.md) | Security architecture and controls |
| [docs/adr](docs/adr) | Architecture decision records |

## Prerequisites

- **Node.js 22** (see [`.nvmrc`](.nvmrc))
- **pnpm 9** via Corepack: `corepack enable`
- **Docker + Docker Compose** for the local stack (Postgres, Redis, MinIO)

## Quickstart

```bash
# 1. Install dependencies
corepack enable
pnpm install

# 2. Configure environment
cp .env.example .env

# 3. Boot the local stack (Postgres + Redis + MinIO)
pnpm stack:up

# 4. Run the workspace (all apps in dev)
pnpm dev
```

## Workspace layout

```
apps/
  api/      NestJS backend (modular monolith)
  web/      Next.js customer web app
  admin/    Next.js admin back office
  mobile/   React Native (Expo) app
packages/
  domain/     shared kernel — Money, currency registry, errors, events
  contracts/  Zod schemas, DTOs, OpenAPI source of truth
  ui-tokens/  design tokens (shared source of truth)
  ui-web/     web component library (Tailwind + shadcn/Radix)
  ui-mobile/  React Native component library
  config/     shared eslint, tsconfig, build config
docs/adr/   architecture decision records
infra/      docker compose and local infrastructure
```

## Common scripts

| Command | Description |
|---|---|
| `pnpm dev` | Run all apps in development (Turborepo) |
| `pnpm build` | Build all apps and packages |
| `pnpm test` | Run the test suites (Vitest) |
| `pnpm lint` | Lint the workspace |
| `pnpm typecheck` | Type-check the workspace |
| `pnpm format` | Format with Prettier |
| `pnpm stack:up` / `stack:down` | Start / stop the local infrastructure |

## Engineering principles

- **Design-for-BaaS** — every external capability is a port with a mock adapter today, a provider adapter later.
- **Correctness first** — money is a double-entry ledger with integer-precise value objects; invariants are tested, not assumed.
- **Security by design** — controls ship with the features they protect. See [security.md](security.md).
- **One language, shared contracts** — TypeScript end to end, with shared domain types and Zod schemas.

## Status

Phase 0 (Foundations) — in progress. See [roadmap.md](roadmap.md) for the phase plan.
