# ADR-0013: Full CI with security gates

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer

## Context

Every change must be verified and screened for security regressions before it can merge, even with a solo maintainer.

## Decision

Run **GitHub Actions** on every push and pull request: lint, typecheck, test, and build via Turborepo, plus **dependency vulnerability audit** (`pnpm audit`), **secret scanning** (gitleaks), and **SAST** (CodeQL). Builds fail on policy violations. Dependabot proposes dependency updates weekly. A husky pre-commit hook runs lint-staged locally.

## Consequences

Positive:

- Regressions and known-vulnerable dependencies are caught before merge.
- Security screening is continuous, not a periodic audit.

Trade-offs / negative:

- Strict gates (e.g. audit level) can block merges on upstream advisories; thresholds may need tuning.

## Alternatives considered

- **Manual/no CI for a solo project** — rejected: security and correctness gates are non-negotiable for a financial platform.
