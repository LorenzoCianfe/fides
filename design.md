# Fides — Product & Experience Design

| Field | Value |
|---|---|
| Document | UX, UI, and system design |
| Version | 0.1.0 |
| Status | Draft — discovery complete |
| Brand direction | Minimal & trustworthy |
| Last updated | 2026-07-04 |

---

## 1. Design principles

1. **Clarity over decoration.** Every screen makes the user's money state and next action obvious. Restraint is the aesthetic.
2. **Trust through calm.** Generous whitespace, quiet color, and typographic hierarchy signal reliability. No visual noise around money.
3. **Consistency across clients.** Web and mobile share one design language via shared tokens; each platform stays idiomatic.
4. **Accessible by default.** WCAG 2.2 AA is a baseline requirement, not a later pass.
5. **Fast and legible.** Numbers, dates, and currencies are formatted for the locale and easy to scan.
6. **Honest states.** Loading, empty, error, and pending states are designed deliberately; the user is never left guessing.

## 2. Brand direction

The register is **minimal and trustworthy** (Trade Republic / N26 family): typography-led, restrained, and serious without being cold. The brand should feel like a calm, competent institution, not a playful consumer app.

- **Voice and tone:** precise, plain, reassuring. Short sentences. No hype, no jargon, no exclamation. Explain money clearly.
- **Logo/wordmark direction:** clean geometric or humanist sans wordmark; a single restrained mark. (Provisional pending final name.)

### 2.1 Provisional color direction

Final values are set in the tokens package during Phase 0. The direction below anchors the language.

| Role | Direction |
|---|---|
| Ink (primary text) | Near-black, slightly warm |
| Surface | Off-white (light) / near-black (dark) |
| Primary accent | A single restrained, confident hue (deep green or ink blue) used sparingly for primary actions and key data |
| Positive / negative | Muted green / muted red, reserved strictly for financial direction and status |
| Neutrals | A calm gray ramp for structure, borders, and secondary text |

Accent is used with discipline: primary actions, active states, and the single most important number on a screen. Semantic colors are reserved for money direction and status, never for decoration.

### 2.2 Typography direction

- One primary typeface (humanist or geometric sans) with a tabular-figures variant for all monetary and numeric data.
- A clear type scale (display, title, body, label, caption) defined as tokens.
- Money is always rendered with tabular figures and consistent currency formatting.

## 3. Design system

**Structure:** a single source of design tokens shared across all clients; platform-specific component libraries consume the tokens.

- `packages/ui-tokens` — the source of truth: color roles, type scale, spacing, radii, elevation, motion. Themeable (light/dark) and locale-agnostic.
- `packages/ui-web` — web components on Tailwind + shadcn/Radix, mapped to tokens.
- `packages/ui-mobile` — a matched React Native component set, mapped to the same tokens.

**Token categories:** color (semantic roles, not raw hues in UI code), typography, spacing scale, radius, elevation/shadow, motion (durations, easings), and z-index. Components reference roles (e.g. `surface`, `accent`, `positive`) so theming and rebranding are centralized.

## 4. Cross-cutting UX commitments

- **Theming:** full light and dark themes from day one, driven by tokens and system preference with manual override.
- **Accessibility (WCAG 2.2 AA):** color-contrast compliance, visible focus, screen-reader semantics, minimum tap targets, reduced-motion support, and full keyboard operability on web.
- **Internationalization:** all copy externalized; locale-aware formatting for currency, number, and date; layout tolerant of text expansion; groundwork for RTL.
- **Responsive web:** mobile-first, scaling to tablet and desktop with a layout that reflows rather than merely stretches.

## 5. Information architecture and navigation

### 5.1 Mobile (iOS / Android)

Primary navigation is a bottom tab bar with five destinations:

1. **Home** — total balance, accounts/wallets, recent activity, quick actions (send, add money, exchange).
2. **Cards** — card carousel, controls, details, freeze/settings.
3. **Payments** — send/request, payees, transfers, scheduled payments, mandates.
4. **Invest** — portfolio, watchlists, instrument detail (simulated).
5. **Insights** — spending analysis, budgets, goals, forecasts.

Account and profile settings, security, and support are reachable from a persistent profile entry point in the Home header.

### 5.2 Web

A left navigation rail mirrors the mobile destinations, expanded for larger viewports, with a top bar for account switching, search, and profile. Content uses a responsive multi-column layout on desktop and collapses to a single column on small screens.

### 5.3 Admin back office

A separate application with role-aware navigation:

- **Dashboard** — operational metrics and system health.
- **Users & accounts** — search, 360 view, lifecycle actions.
- **Cards** — search and card operations.
- **Cases** — investigation queues, triage, detail.
- **Financial operations** — reversals, adjustments, limit overrides (four-eyes).
- **Communications** — user messaging and templates.
- **Reporting** — compliance exports and audit reports.

Navigation and actions are gated by role; unavailable actions are hidden or clearly disabled with rationale.

## 6. Key user flows

- **Onboarding:** welcome → identity capture → document + liveness (simulated) → screening/decision → passkey enrolment → account created. Progress is explicit; pending/verification states are first-class.
- **Send money:** choose recipient (payee or P2P) → amount and currency → review (fees/FX shown) → SCA step-up → confirmation → activity entry.
- **Add / receive money:** show IBAN and share; inbound credit appears in activity with clear provenance.
- **Exchange (FX):** select source/target wallets → amount → live simulated quote with rate and rounding shown → confirm → both wallets update.
- **Card management:** view card → freeze/unfreeze, set limits, toggle channels/categories → sensitive changes require SCA.
- **Savings:** create vault/goal → fund → track progress → interest accrual visible.
- **Investing (simulated):** browse/watch instrument → place simulated order → view position and portfolio.
- **Insights:** review categorized spend → set a budget → see forecast and recurring payments.

## 7. Screen inventory (initial)

Customer (mobile and web): Home/overview, Account detail, Wallet detail, Send/Request, Payee management, Scheduled payments & mandates, Exchange, Card list & detail, Card controls, Savings list & goal detail, Invest overview, Instrument detail, Insights overview, Budget detail, Profile & settings, Security, Onboarding sequence, Notifications.

Admin: Dashboard, User search, User/account 360, Card operations, Case queue, Case detail, Financial operations, Communications, Reporting & exports, Audit log viewer, Role administration.

## 8. Interaction and content guidelines

- **Money display:** always show currency and use tabular figures; show fees and FX rates before confirmation, never after.
- **Confirmation for irreversible or sensitive actions:** explicit review step plus SCA where required.
- **Empty and pending states:** explain what will appear and what the user can do next.
- **Errors:** plain-language, actionable, never a raw code; align with the shared error taxonomy in [documentation.md](documentation.md).
- **Notifications:** timely and specific (e.g. transaction posted, card frozen, verification complete); respect quiet defaults.

## 9. Change log

| Version | Date | Change |
|---|---|---|
| 0.1.0 | 2026-07-04 | Initial design language, navigation model, flows, and screen inventory. |
