# ADR-0006: Next.js web and admin; React Native (Expo) mobile

- Status: Accepted
- Date: 2026-07-04
- Deciders: Solo maintainer

## Context

The product needs a responsive customer web app, a separate admin back office, and native iOS/Android apps, all sharing one design language and TypeScript contracts.

## Decision

Use **Next.js (React)** for the customer web app and the admin back office (separate apps), and **React Native (Expo)** for mobile. All consume shared `@fides/ui-tokens`; web/admin use `@fides/ui-web` (Tailwind + shadcn/Radix), mobile uses `@fides/ui-mobile`.

## Consequences

Positive:

- React across web and mobile; shared tokens guarantee a consistent design language.
- Expo streamlines native builds and OTA updates; Next.js gives SSR and strong DX.

Trade-offs / negative:

- Two component libraries (web, mobile) must be kept in visual parity.
- iOS device/simulator builds require macOS tooling.

## Alternatives considered

- **A single cross-platform UI (e.g. React Native Web everywhere)** — rejected: compromises web ergonomics and SEO.
- **Native Swift/Kotlin apps** — rejected: doubles language surface for a solo maintainer.
