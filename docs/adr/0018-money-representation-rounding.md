# ADR-0018: Money representation and rounding policy

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer

## Context

Monetary values must be exact and reproducible. Floating-point arithmetic is unacceptable, and rounding (for FX and interest) must be explicit, documented, and tested rather than implicit.

## Decision

Represent money as **integer minor units** (`bigint`) with an explicit currency, via an immutable, currency-safe `Money` value object. Cross-currency arithmetic throws; constructing a value with more precision than the currency allows throws. Intermediate FX/interest computations use exact **rational (`bigint` numerator/denominator)** arithmetic, never floats. Rounding is **explicit and parameterized**; the platform default is **half-up** (`DEFAULT_ROUNDING_MODE`), with banker's rounding (`HALF_EVEN`) and others available where required. `allocate` splits amounts with no minor unit lost.

## Consequences

Positive:

- Deterministic, float-free money math; invariants are unit-tested.
- Rounding decisions are visible at the call site and in this record.

Trade-offs / negative:

- Callers must pass fractional factors (e.g. FX rates) as decimal strings for exactness, not JS numbers.

## Alternatives considered

- **Floating-point or `number` amounts** — rejected: precision loss is unacceptable for money.
- **A decimal library for storage** — rejected: integer minor units are simpler, exact, and sufficient; `NUMERIC`/rationals cover intermediates.
