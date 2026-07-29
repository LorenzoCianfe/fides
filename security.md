# Fides — Security Model

| Field | Value |
|---|---|
| Document | Security architecture and controls |
| Version | 0.7.0 |
| Status | Living — Phase 1 controls landing |
| Regulatory frame | EU/EEA: PSD2/SCA, GDPR (simulated, unlicensed) |
| Last updated | 2026-07-29 |

---

## 1. Security posture

Security is a top-level design principle across the platform and its administration environment. The model is defence in depth: independent controls at identity, application, data, and operational layers, such that the failure of any single control does not compromise customer funds, data, or trust.

Note on status: Fides is a simulated core and not a licensed institution. Real customer funds do not move, and no real card numbers (PANs) are handled. The controls below are engineered to production standards so the platform is credible and directly hardenable for a future BaaS-backed deployment.

### 1.1 Core tenets

1. **Least privilege** everywhere — users, admins, services, and credentials.
2. **Secure by design** — controls ship with the features they protect, not afterwards.
3. **Zero implicit trust between tiers** — clients are untrusted; the API authorizes every request.
4. **Immutable auditability** — sensitive and administrative actions are recorded tamper-evidently.
5. **Data minimization** — collect and retain only what is necessary, for only as long as necessary.
6. **No silent failure** — security-relevant errors are surfaced, logged, and monitored.

## 2. Identity and authentication

### 2.1 Model

- **Passkeys / WebAuthn** are the primary, phishing-resistant authentication method (possession + inherence).
- **Device binding** on mobile: enrolled devices are cryptographically associated with the account.
- **App unlock** via biometric or PIN provides fast local re-authentication; it complements, not replaces, server-side authentication.
- Identity is **self-managed** and stored in the platform's own PostgreSQL, giving full control, EU data residency, and no third-party lock-in.

### 2.2 Strong Customer Authentication (PSD2 SCA)

- Login and sensitive operations require two independent factors from the categories knowledge, possession, and inherence.
- **Step-up SCA** is enforced for high-risk actions: outbound payments, adding payees, changing security settings, raising limits, and sensitive card actions.
- SCA is designed with dynamic linking in mind for payment operations (authentication bound to amount and payee).
- Implemented (Phase 1, ADR-0020/0021): every WebAuthn assertion requires user verification (two factors per ceremony); the step-up seam binds an action-hashed challenge to a fresh assertion and mints a single-use grant that the guarded operation consumes atomically.
- Implemented (Phase 1 Slice 5, ADR-0023): dynamic linking is now **enforced on the internal P2P transfer**. The server recomputes the action hash from the *executed* amount and payee (never from a client-supplied action) and consumes the single-use grant inside the posting transaction, so a tampered amount or payee changes the hash and fails with the generic authentication error; the grant is consumed exactly once and idempotent retries neither re-consume it nor re-post.

### 2.3 Sessions

- Short-lived access tokens with refresh; server-side session and device records enable immediate revocation.
- Idle and absolute session timeouts; re-authentication on sensitive actions.
- Anomalous-session signals (new device, geo velocity) feed the risk engine.
- Implemented (Phase 1, ADR-0020/0021): opaque hashed tokens validated against the session row on every request, rotation with reuse detection, per-device session listing and revocation over `/v1/auth`, per-IP rate limiting on the auth endpoints, and a retention sweeper. Since Slice 6 (ADR-0024) dead sessions are purged **promptly** — the forensic record of any revocation or refresh-reuse revocation now lives in the tamper-evident audit trail — rather than kept for the earlier 90-day grace.

#### Token transport and CSRF (Slice 8, ADR-0027)

Transport is negotiated **per request by the client**, not per deployment: a client sends `X-Fides-Token-Transport: cookie` on the three routes that mint or rotate a session, and everything else stays on the ADR-0021 bearer contract. Web and mobile therefore share one API and one contract with no user-agent sniffing.

- **Cookie mode withholds the tokens from the response body.** The pair is set `httpOnly` and `SameSite=Strict`; echoing the tokens in the body as well would return them to script and defeat the mode. The access cookie is scoped to `/v1`; the refresh cookie is scoped to `/v1/auth/refresh`, so the longest-lived credential is absent from ordinary API traffic. This closes the ADR-0021 gap in which a browser held a refresh token in script-reachable storage.
- **CSRF is a double-submit token bound to the session row.** A random `fcs_` token is stored as a SHA-256 hash on the session and returned in a deliberately readable cookie; the client echoes it in `X-CSRF-Token` and the guard compares hashes in constant time. Bearer callers are exempt — an explicitly-set header is not an ambient credential. A session issued in bearer mode holds no hash and therefore cannot be driven from a cookie at all: the check **fails closed**.
- **Refresh is checked inside its rotation transaction**, not by the guard, because it deliberately runs on an expired access token and cannot sit behind `SessionAuthGuard`. The check is ordered after reuse detection and before any rotation, so a stolen token still trips the alarm while a cross-site caller cannot churn a victim's token pair.
- **`SameSite=Strict` requires the web client and the API to be same-site** (different ports or subdomains are fine; different registrable domains are not). A cross-site deployment must use `SameSite=None`, where the CSRF token becomes the sole defence — which is why it is not optional. Configuration rejects `None` without `Secure`, a pair browsers silently drop.

## 3. Authorization

### 3.1 Customer authorization

- Every API request is authorized server-side against the authenticated principal and resource ownership. Object-level checks prevent access to another user's accounts, cards, or data.
- Input is validated against shared Zod schemas; the API never trusts client-supplied identifiers implicitly.
- Implemented (Phase 1, Slice 4): the `/v1/accounts` read surface is session-guarded and ownership-scoped — the list is bound to the authenticated principal and the single-account read resolves the owner server-side and asserts ownership (`assertResourceOwnership`), so one user's account id cannot be used to read another's. Account identifiers are non-enumerable UUID v7.
- Implemented (Phase 1, Slice 5, ADR-0023): the wallet transaction-history read (`GET /v1/wallets/{walletId}/transactions`) resolves the wallet to its owner server-side and asserts ownership before returning any history, so a wallet id cannot be used to read another user's transactions. The P2P transfer is a money-moving operation and requires an `Idempotency-Key`.
- Closed (Phase 1, Slice 7, ADR-0025): the self-service dev funding faucet (`POST /v1/dev/funding`) and its `DEV_FUNDING_ENABLED` kill-switch are **retired**. A customer can no longer credit their own wallet by any route. Funding is now an admin-only operation reached solely through the four-eyes workflow (§3.2), authorized by role rather than by configuration and still bounded by a per-request cap (`ADMIN_FUNDING_MAX_MINOR`).

### 3.2 Admin authorization (back office)

- **Granular RBAC** with named roles: super-admin, compliance/AML officer, fraud analyst, support agent, and read-only auditor.
- **Segregation of duties:** no single role can both initiate and approve a sensitive action.
- **Four-eyes (maker-checker):** high-risk operations (account suspension, fund reversal, limit override, KYC override) are requested by one operator and approved by another.
- **Mandatory admin MFA** and shorter session lifetimes for all back-office access.
- **Scoped access:** admins see only what their role requires; the audited "assist / view-as-customer" mode is explicit, time-boxed, and logged.

Implemented (Phase 1, Slice 7, ADR-0025):

- **Separate admin identity.** Back-office operators live in their own `admins` table with their own guard, principal, session table, and token prefix (`ast_`, versus the customer `fat_`). Customer and admin authentication share no table and no code path, so no customer-facing authorization defect can yield back-office access, and `assertResourceOwnership` keeps a single, customer-only meaning. Admin authorization is by **capability, never ownership**.
- **Two independent factors, in two steps.** A correct password returns only a single-use, five-minute, hashed **login challenge** — never a session. The session is issued solely by `POST /v1/admin/auth/mfa/verify` after an RFC 6238 TOTP code verifies, so no back-office session can rest on one factor. Passwords are hashed with scrypt (N=2^15, r=8, p=1) in a self-describing format so work factors can be raised without a migration, and login failures are uniform and constant-time across unknown, disabled, and wrong-password admins. A TOTP code cannot be replayed even inside its own validity window (a strictly-increasing accepted time step). The TOTP implementation is verified against the RFC 6238 test vectors.
- **Enrolment without a shared secret.** The bootstrap admin is seeded from configuration only when **no admin exists at all**, so configuration cannot add or reset an operator once the back office is live. It carries no second factor: the secret is generated on first login, returned exactly once, and activated only when a code minted from it verifies. Newly staffed admins follow the same path.
- **Shorter sessions.** One opaque 256-bit token stored only as a SHA-256 hash, with a **30-minute sliding idle window** and a hard **8-hour absolute cap** (both env-tunable). Every request is validated against the row, so revocation and account disablement take effect immediately rather than at the next expiry. Dead admin sessions and spent login challenges are purged promptly by the retention sweeper.
- **Permissions, not role checks.** A code-defined `PERMISSIONS_BY_ROLE` matrix is the single source of authorization truth, enforced by a `@RequirePermission` guard that fails closed if a route declares no permission. The matrix lives in code so it is reviewable in diffs and cannot be widened by a privileged SQL statement.
- **Segregation of duties is structural.** `admin_funding.request` is held by the compliance officer and support agent; `admin_funding.approve` by the super-admin alone, which is deliberately **denied** the request half. No role holds both, and a unit test asserts that as an invariant over the whole matrix, so widening a role until it can self-approve fails the build. A runtime `checkerId != makerId` check and a database CHECK constraint are the second and third lines of defence.
- **Four-eyes, proven on real money.** Admin funding is filed by a maker and moves nothing; a differently-roled checker approves it, and the credit posts **inside the same transaction that transitions the request out of `pending`**, under a row lock. A concurrent double-approval cannot post twice, a failed posting leaves the request pending rather than approved-but-unexecuted, and a retry carrying the original `Idempotency-Key` replays the first result. Requests expire after 24 hours. Breadth (suspension, reversal, card freeze) is deferred to Phase 2/3 with the actions it would govern.
- **Every admin action is audited** with `actor_type = 'admin'` on the append-only, hash-chained trail (ADR-0024): session issue and revocation, MFA enrolment, operator creation and status change, and the funding request, approval, and execution. Bootstrap seeding is recorded as a `system` actor.
- **Read-only views** cover the customer directory and detail, any wallet's transaction history, a ledger account beside its recomputed reconciliation state, and the audit trail read and verification that Slice 6 deferred (behind `audit.read` — auditor or higher; the support agent does not hold it).
- Not yet implemented: password rotation and self-service password change, TOTP reset, and the "assist / view-as-customer" mode (deferred to Phase 2). TOTP secrets are stored unencrypted at rest — see §6.2 and the known gaps in `docs/phase-1-handoff.md`.

## 4. KYC / AML and screening (simulated)

The onboarding pipeline is modelled end-to-end behind mock adapters, so real providers plug in later without redesign.

- **Identity data capture** and validation.
- **Document capture** and a **liveness/selfie** step (scripted mock).
- **Sanctions and PEP screening** against the `ScreeningPort`.
- **Risk scoring** and a decision (approve / review / reject); borderline cases escalate to the admin case queue.
- Ongoing screening hooks are reserved for periodic re-checks.

## 5. Fraud and transaction monitoring

- **Real-time, rules-based engine** evaluates money-moving events before and after execution as appropriate.
- **Signals:** velocity and amount limits, geo/anomaly rules, device signals, blocklists, and account-behavior baselines.
- **Scoring and actions:** events are scored; thresholds trigger challenge (step-up SCA), hold, block, or case creation.
- **Case management:** flagged events flow into admin queues for triage and investigation; actions taken are audited and, where sensitive, subject to four-eyes.
- The engine is designed for extension to ML-based scoring later without changing the interception points.

## 6. Data protection and cryptography

### 6.1 In transit

- TLS for all client-server and server-service communication; modern cipher suites; HSTS on web.
- Implemented (Slice 8, ADR-0027): security headers via helmet on every response. **HSTS** at two years with `includeSubDomains` and `preload`, emitted unconditionally — browsers ignore it over plain HTTP, so it costs nothing locally and is correct the moment TLS terminates in front of the API. The JSON surface carries the tightest possible content policy (`default-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`) because it needs to load nothing; the relaxation Swagger UI requires is scoped to `/docs` alone rather than applied to the money-moving surface. `Cross-Origin-Resource-Policy` is `cross-origin` because CORS, not CORP, is the control that governs a cross-origin JSON API. CORS is credentialed against the existing origin allowlist, with an explicit request-header allowlist.

### 6.2 At rest

- Encryption at rest for databases, object storage, and backups.
- **Field-level encryption / tokenization** for sensitive PII (identity documents, personal identifiers), separating access to sensitive fields from general application data.
- **Envelope encryption** via a KMS abstraction; keys are managed and rotated, never embedded in code or images.

Known gap (Phase 1, Slice 7, ADR-0025): **admin TOTP secrets are stored unencrypted.** Every other secret in the system is stored only as a hash, but TOTP verification needs the secret itself, so it cannot be. This is an accepted interim gap until the field-level/KMS encryption above exists; the blast radius is bounded to the second factor of a handful of back-office accounts whose first factor is separately scrypt-hashed. It is the first candidate for field-level encryption when that lands.

### 6.3 Secrets

- Secrets are held in a dedicated secrets manager/vault and injected via environment/configuration at runtime.
- No secrets, keys, or credentials in source control; CI enforces secret scanning.

### 6.4 PCI-DSS scope

- Because cards and PANs are **simulated**, the platform does not store, process, or transmit real card numbers. PCI-DSS scope is minimized by design. A future move to a real card program would route PANs to a PCI-compliant issuer/processor rather than the platform.

## 7. Data governance and GDPR

- **Lawful basis and minimization:** collect only necessary data; document purpose and basis.
- **Retention:** defined retention periods per data category; automated expiry where feasible.
- **Data-subject rights:** access, rectification, erasure, and portability supported operationally (with lawful-retention exceptions).
- **Residency:** data is hosted in the EU/EEA; self-managed identity avoids exporting personal data to third parties.
- **Consent and disclosures:** clear, granular consent for optional processing; transparent privacy notices.

## 8. Audit and tamper-evidence

- Every sensitive customer action and every administrative action is written to an **immutable, append-only audit trail**, capturing actor, action, target, before/after where applicable, timestamp, and correlation identifiers.
- The audit trail is tamper-evident and separate from mutable application state.
- Four-eyes approvals, assist-mode sessions, and role changes are all audited.
- Implemented (Phase 1 Slice 6, ADR-0024): a hash-chained `audit_log` records the sensitive actions now in place — P2P transfer, dev funding, SCA step-up, session revocation and refresh-reuse revocation, and account provisioning — each written **inside the audited action's own transaction**, so no action occurs without its audit. Records capture actor (customer or `system`), action, target, timestamp, and correlation id, with before/after only for mutations of mutable state (e.g. a session revocation) and **internal references only, never raw PII**, since the trail is un-erasable. Integrity is one global chain (`sha256(prev_hash + canonical(record))`, gap-free sequence) confirmed by `verifyAuditChain`; the database rejects UPDATE/DELETE via the same append-only triggers as the ledger, so any out-of-band edit or deletion of a past record breaks the chain (deletion of the most recent record — truncation — additionally needs an external anchor, deferred). Admin read/verify surfaces over the trail arrive with admin RBAC (Slice 7).

## 9. Secure development lifecycle

- **CI security gates on every change:** dependency vulnerability audit, static analysis (SAST), secret scanning, lint, and typecheck; builds fail on policy violations.
- **Testing for security-relevant logic:** authorization checks, SCA enforcement, and ledger invariants are covered by tests.
- **Least-privilege dependencies:** minimal, vetted libraries; pinned versions; regular updates.
- **Code review and ADRs** for security-affecting changes.
- **Threat modelling** revisited per phase and before release (Phase 7).

### 9.1 Dependency advisory handling (ADR-0026)

The dependency gate is `pnpm audit --prod --audit-level=high`, blocking on every pull request. Advisories are resolved in a fixed order of preference, and the order matters more than the outcome of any single finding:

1. **Move the direct dependency** within its pinned major. Framework majors stay deferred to Phase 7, so a fix requiring one is escalated rather than taken quietly.
2. **Override the transitive pin** when an intermediate package holds a vulnerable version it has not yet released a fix for. Override keys carry the advisory's own vulnerable range, never a bare package name, so an override upgrades exactly the affected line and cannot silently drag an unrelated major across a breaking boundary.
3. **Patch the dependency** when the only version clearing an advisory breaks its consumers. The patch restores the removed API rather than rewriting consumers, is pinned to an exact version so a later release fails loudly instead of dropping the shim, and carries a documented exit condition.
4. **Suppress via `ignoreGhsas`** only when no patched version exists anywhere. Each suppression is recorded with its reachability analysis and revisited when the package moves.

One suppression is currently in force: `GHSA-r5fr-rjxr-66jc` (code injection via `lodash`'s `_.template`), which reaches `apps/api` through `@nestjs/swagger`. Its declared patch target `lodash >= 4.18.0` has never been published, so there is nothing to upgrade to; `_.template` is not invoked on untrusted input on any reachable path. Because pnpm counts suppressed advisories in its summary tally but excludes them from the exit code, **the gate's exit status — not its headline count — is the signal**.

Two findings sit below the gate threshold and are knowingly open: `@nestjs/core` (moderate) is patched only in a Nest major that belongs to Phase 7, and the remaining moderates are build-tooling transitives with no path from a shipped artifact.

## 10. Threat model (summary)

**Key assets:** customer funds (ledger integrity), customer PII, authentication credentials, admin capabilities, and the audit trail.

**Primary actors of concern:** external attackers (credential theft, fraud, API abuse), malicious or compromised insiders, and automated abuse.

| Category (STRIDE) | Representative risk | Primary mitigations |
|---|---|---|
| Spoofing | Account takeover | Passkeys, device binding, step-up SCA, session revocation |
| Tampering | Ledger/data manipulation | Double-entry invariants, append-only ledger, audit trail, authz |
| Repudiation | Disputed admin action | Immutable audit, four-eyes, correlation IDs |
| Information disclosure | PII leakage | Field-level encryption, least privilege, object-level authz |
| Denial of service | Abuse/overload | Rate limiting, idempotency, input validation |
| Elevation of privilege | Admin over-reach | RBAC, segregation of duties, scoped assist mode |

## 11. Monitoring and incident response

- Security-relevant events (auth failures, SCA challenges, risk actions, admin actions) are logged and monitored.
- Alerting thresholds route to operational review; the risk engine and audit trail support investigation.
- An incident-response process (detection, containment, eradication, recovery, post-incident review) is documented and validated during hardening (Phase 7).

## 12. Compliance mapping

| Requirement | Approach |
|---|---|
| PSD2 SCA | Passkeys + step-up multi-factor authentication; dynamic linking for payments |
| GDPR | Minimization, retention, data-subject rights, EU residency, self-managed identity |
| AML/KYC (as modelled) | Onboarding verification, sanctions/PEP screening, risk scoring, case management |
| PCI-DSS | Scope minimized; no real PANs handled in the simulated core |

Fides is not a licensed institution; this mapping documents how the design aligns with the relevant frameworks so that a future BaaS-backed, licensed deployment inherits a sound security foundation.

## 13. Change log

| Version | Date | Change |
|---|---|---|
| 0.7.0 | 2026-07-29 | Phase 1 Slice 8 Wave A: client token transport and web hardening (ADR-0027). Closes two standing gaps. An **opt-in, per-request httpOnly-cookie transport** (§2.3) removes the ADR-0021 XSS exposure of a browser-held refresh token: the token pair is withheld from the response body, `SameSite=Strict`, with the refresh cookie scoped to the single route that spends it, defended by a double-submit CSRF token hashed onto the session row and enforced inside the refresh rotation transaction as well as by the guard. Bearer callers are exempt and unchanged; a bearer-issued session cannot be driven from a cookie (fails closed). **Security headers** (§6.1) via helmet: two-year HSTS with preload, a `default-src 'none'` policy on the JSON surface with the Swagger relaxation confined to `/docs`, and credentialed CORS. Adds the native passkey app-association documents served from the API itself. Migration `0011`. |
| 0.6.1 | 2026-07-29 | Dependency advisory handling written down as a policy (§9.1, ADR-0026) and the blocking audit gate returned to green: ten high-severity advisories across `next`, `postcss`, `sharp`, `js-yaml`, and `brace-expansion` closed by in-major bumps, range-scoped transitive overrides, and one patched dependency, with no new suppression added. Documents the single standing `lodash` suppression and its reachability analysis, and the two moderates left open below the gate threshold. |
| 0.6.0 | 2026-07-28 | Phase 1 Slice 7: back-office controls implemented (ADR-0025). Separate admin identity isolated from customer authentication at every layer; mandatory two-factor sign-in (scrypt password + RFC 6238 TOTP, no session on one factor, replay-proof codes); 30-minute sliding idle / 8-hour absolute admin sessions with immediate revocation and disablement; a code-defined role→permission matrix behind `@RequirePermission`, with segregation of duties enforced structurally (no role holds both halves of the funding pair) and backed by runtime and database checks; four-eyes proven end to end on admin funding, executed atomically with the approval; every admin action recorded on the tamper-evident trail with `actor_type = 'admin'`; the audit read/verify surface exposed behind `audit.read`. The self-service dev funding faucet is retired (§3.1). New known gap: TOTP secrets are stored unencrypted (§6.2). |
| 0.5.0 | 2026-07-13 | Phase 1 Slice 6: append-only, hash-chained audit trail (ADR-0024). Sensitive actions (P2P transfer, dev funding, SCA step-up, session revocation and refresh-reuse revocation, account provisioning) are recorded to an immutable, tamper-evident `audit_log` inside each action's own transaction; one global hash chain verified by `verifyAuditChain`, with the ledger's append-only triggers rejecting UPDATE/DELETE. Records hold internal references only (no raw PII). Dead-session retention tightened from a 90-day forensic grace to prompt purge now that the forensic record lives in the trail; the SCA-grant→session FK set to `ON DELETE CASCADE`. |
| 0.4.0 | 2026-07-12 | Phase 1 Slice 5: PSD2 dynamic linking enforced on the internal P2P transfer (server-side action-hash recomputation, single-use grant consumed atomically in the posting transaction); object-level authorization on the wallet transaction-history read; dev funding faucet documented as a kill-switched, self-scoped interim control until admin RBAC (ADR-0023). |
| 0.3.0 | 2026-07-12 | Phase 1 Slice 4: object-level authorization enforced on the `/v1/accounts` customer resource (session guard + server-side ownership assertion); account provisioning is event-driven and idempotent (ADR-0022). |
| 0.2.0 | 2026-07-06 | Phase 1 Slice 3 controls implemented and annotated: passkey/WebAuthn two-factor ceremonies with anti-enumeration, opaque server-side sessions with immediate revocation (ADR-0020); SCA step-up with dynamic linking, auth rate limiting, and the retention sweeper (ADR-0021). |
| 0.1.0 | 2026-07-04 | Initial security model: identity, authz, KYC/AML, monitoring, data protection, audit, SDLC, threat model. |
