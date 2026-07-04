# ADR-0016: Minimal, trustworthy design language with shared tokens

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer

## Context

The brand must feel like a calm, competent institution (Trade Republic / N26 family) and stay consistent across web, admin, and mobile, with accessibility and theming built in.

## Decision

Adopt a **minimal, trustworthy** design language driven by a single **design-tokens** package (`@fides/ui-tokens`): semantic color roles (light/dark), a type scale with tabular figures for money, and spacing/radius/elevation/motion tokens. Platform component libraries (`@fides/ui-web` on Tailwind + shadcn/Radix, `@fides/ui-mobile` for React Native) consume the same tokens. WCAG 2.2 AA, full theming, and i18n are baseline requirements.

## Consequences

Positive:

- One source of truth for design; rebranding/retheming is centralized.
- Accessibility and dark mode are structural, not retrofitted.

Trade-offs / negative:

- Two component libraries must be maintained in visual parity against the tokens.

## Alternatives considered

- **Per-app ad hoc styling** — rejected: guarantees drift and inconsistent money presentation.
- **A heavy off-the-shelf design system** — rejected: conflicts with the restrained, bespoke brand.
