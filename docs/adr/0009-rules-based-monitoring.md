# ADR-0009: Rules-based transaction monitoring engine

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer

## Context

Money-moving events need real-time and post-hoc monitoring for fraud/AML, with clear, explainable interception points. ML scoring is out of scope for now.

## Decision

Implement a **rules-based engine** evaluating events before/after execution: velocity and amount limits, geo/anomaly rules, device signals, blocklists, and behavior baselines. Events are scored; thresholds trigger challenge (step-up SCA), hold, block, or case creation. Interception points are designed so ML scoring can be added later without moving them.

## Consequences

Positive:

- Explainable, testable controls with clear escalation into cases.
- Extension to ML scoring later leaves interception points unchanged.

Trade-offs / negative:

- Rules require tuning to balance false positives and coverage.

## Alternatives considered

- **ML-based scoring now** — rejected (ADR scope): needs data and adds opacity; deferred.
- **No monitoring in the simulated core** — rejected: monitoring is core to credibility and to admin case flows.
