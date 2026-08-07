# Architecture Decision Records

Each ADR captures one significant decision, its context, and its consequences. ADRs are immutable once accepted; a change is a new ADR that supersedes the old one. Format follows a lightweight [MADR](https://adr.github.io/madr/) style — see [0000-template.md](0000-template.md).

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-simulated-core-hexagonal.md) | Simulated core with hexagonal ports/adapters (design-for-BaaS) | Accepted |
| [0002](0002-eu-regulatory-frame.md) | EU/EEA regulatory frame: PSD2/SCA, GDPR, EMI semantics | Accepted |
| [0003](0003-typescript-nestjs-backend.md) | TypeScript + NestJS backend | Accepted |
| [0004](0004-modular-monolith-monorepo.md) | Modular monolith in a pnpm/Turborepo monorepo | Accepted |
| [0005](0005-postgres-double-entry-ledger.md) | PostgreSQL + append-only double-entry ledger + event/outbox | Accepted |
| [0006](0006-nextjs-and-expo-clients.md) | Next.js web and admin; React Native (Expo) mobile | Accepted |
| [0007](0007-passkeys-self-managed-identity.md) | Passkeys-first, self-managed identity with step-up SCA | Accepted |
| [0008](0008-simulated-kyc-aml-pipeline.md) | Full simulated KYC/AML onboarding pipeline | Accepted |
| [0009](0009-rules-based-monitoring.md) | Rules-based transaction monitoring engine | Accepted |
| [0010](0010-data-protection-pci-scope.md) | Full data-protection posture; minimized PCI scope | Accepted |
| [0011](0011-admin-rbac-four-eyes.md) | Admin RBAC with segregation of duties and four-eyes | Accepted |
| [0012](0012-local-first-eu-cloud.md) | Local-first environments; EU cloud later | Accepted |
| [0013](0013-ci-security-gates.md) | Full CI with security gates | Accepted |
| [0014](0014-testing-strategy.md) | Ledger-focused testing strategy (Vitest) | Accepted |
| [0015](0015-docs-as-code-openapi.md) | Docs-as-code with ADRs and Zod-first OpenAPI | Accepted |
| [0016](0016-design-language-tokens.md) | Minimal, trustworthy design language; shared tokens | Accepted |
| [0017](0017-orm-drizzle.md) | ORM selection: Drizzle | Accepted |
| [0018](0018-money-representation-rounding.md) | Money representation and rounding policy | Accepted |
| [0019](0019-synchronous-balance-projection.md) | Synchronous in-transaction balance projection (refines 0005) | Accepted |
| [0020](0020-session-tokens-webauthn-policy.md) | Opaque server-side session tokens and WebAuthn ceremony policy (refines 0007) | Accepted |
| [0021](0021-http-auth-surface-policy.md) | HTTP auth surface: token transport, SCA dynamic linking, throttling, retention (refines 0007, 0020) | Accepted |
| [0022](0022-account-provisioning-model.md) | Account provisioning and the account/wallet/ledger-account model (refines 0005, 0019) | Accepted |
| [0023](0023-p2p-transfer-sca-enforcement-dev-funding.md) | Internal P2P transfer: SCA enforcement, dev funding, and the transaction-history read (refines 0019, 0021, 0022) | Accepted |
| [0024](0024-append-only-hash-chained-audit-trail.md) | Append-only, hash-chained audit trail (refines 0005, 0019, 0021) | Accepted |
| [0025](0025-admin-rbac-mfa-four-eyes.md) | Admin identity, RBAC, MFA, and four-eyes on admin funding (refines 0011) | Accepted |
| [0026](0026-dependency-audit-remediation.md) | Dependency audit remediation: scoped transitive overrides and the brace-expansion patch (refines 0013) | Accepted |
| [0027](0027-client-token-transport-security-headers.md) | Client token transport, CSRF defence, security headers, and native app association (refines 0020, 0021) | Accepted |
| [0028](0028-field-level-encryption-totp-secrets.md) | Field-level encryption: a KMS-shaped keyring, applied first to admin TOTP secrets (refines 0010, 0025) | Accepted |
| [0029](0029-admin-login-lockout-denied-attempt-audit.md) | Per-account admin lockout and auditing denied attempts (refines 0024, 0025) | Accepted |
| [0030](0030-admin-credential-recovery.md) | Admin credential rotation and four-eyes second-factor reset (refines 0011, 0025, 0029) | Accepted |
