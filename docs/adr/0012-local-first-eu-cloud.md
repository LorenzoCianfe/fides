# ADR-0012: Local-first environments; EU cloud later

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer

## Context

Development must be fast and reproducible for a solo maintainer, with a clean path to an EU-region cloud deployment when needed.

## Decision

Adopt a **local-first** environment: **Docker Compose** provisions Postgres, Redis, and an S3-compatible store (MinIO) so the full stack boots via a single command. Configuration is 12-factor and environment-driven, so an **EU-region managed deployment** (managed Postgres, object storage, observability) is a later configuration step, not a rewrite.

## Consequences

Positive:

- Zero-cost, reproducible local stack; single-command boot.
- 12-factor config makes EU-cloud promotion straightforward.

Trade-offs / negative:

- Local mocks of managed services differ subtly from cloud equivalents; validated at deploy time.

## Alternatives considered

- **Cloud-only dev environments** — rejected: slower iteration, cost, and network dependence for a solo build.
