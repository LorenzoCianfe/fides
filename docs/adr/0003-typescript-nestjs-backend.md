# ADR-0003: TypeScript + NestJS backend

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer

## Context

A solo maintainer must build backend, web, admin, and mobile. One language across tiers reduces context switching and enables shared domain types and validation.

## Decision

Use **TypeScript (strict)** everywhere and **NestJS** for the backend. NestJS provides a mature module system, dependency injection, and clear boundaries that suit a modular monolith with hexagonal modules.

## Consequences

Positive:

- Shared types, `Money`, and Zod schemas flow from backend to clients with no drift.
- NestJS DI and modules map cleanly onto hexagonal domain modules.

Trade-offs / negative:

- NestJS decorators/DI add a learning and boilerplate surface versus a micro-framework.

## Alternatives considered

- **Node + Express/Fastify only** — rejected: less structure for a large modular domain.
- **A non-TS backend (Go, Kotlin)** — rejected: loses one-language shared contracts across all clients.
