# ADR-0015: Docs-as-code with ADRs and Zod-first OpenAPI

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer

## Context

Documentation and API contracts must stay in step with the code and never drift. There should be a single source of truth for request/response shapes shared by backend and clients.

## Decision

Maintain documentation **as code**: four evolving root docs (`documentation.md`, `roadmap.md`, `design.md`, `security.md`), numbered **ADRs** under `docs/adr/`, and semantic versioning with a `CHANGELOG.md`. The API contract is **Zod-first**: Zod schemas in `@fides/contracts` are the single source; `nestjs-zod` validates requests and `zod-to-openapi` generates the OpenAPI document served at `/docs`.

## Consequences

Positive:

- Validation, TypeScript types, and OpenAPI all derive from one Zod definition — no drift.
- Decisions and their rationale are versioned alongside the code.

Trade-offs / negative:

- Contributors must author schemas in Zod rather than framework-specific DTO decorators.

## Alternatives considered

- **NestJS Swagger decorators** — rejected: two sources of truth (validation vs. docs) to keep in sync.
- **Hand-written OpenAPI** — rejected: drifts from the code immediately.
