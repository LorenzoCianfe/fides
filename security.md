# Fides — Security Model

| Field | Value |
|---|---|
| Document | Security architecture and controls |
| Version | 0.5.0 |
| Status | Living — Phase 1 controls landing |
| Regulatory frame | EU/EEA: PSD2/SCA, GDPR (simulated, unlicensed) |
| Last updated | 2026-07-13 |

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

## 3. Authorization

### 3.1 Customer authorization

- Every API request is authorized server-side against the authenticated principal and resource ownership. Object-level checks prevent access to another user's accounts, cards, or data.
- Input is validated against shared Zod schemas; the API never trusts client-supplied identifiers implicitly.
- Implemented (Phase 1, Slice 4): the `/v1/accounts` read surface is session-guarded and ownership-scoped — the list is bound to the authenticated principal and the single-account read resolves the owner server-side and asserts ownership (`assertResourceOwnership`), so one user's account id cannot be used to read another's. Account identifiers are non-enumerable UUID v7.
- Implemented (Phase 1, Slice 5, ADR-0023): the wallet transaction-history read (`GET /v1/wallets/{walletId}/transactions`) resolves the wallet to its owner server-side and asserts ownership before returning any history, so a wallet id cannot be used to read another user's transactions. The P2P transfer and dev funding are money-moving operations and require an `Idempotency-Key`. The dev funding faucet (`POST /v1/dev/funding`) credits only the caller's own wallet, is amount-capped, and is gated by `DEV_FUNDING_ENABLED` (off by default; answers 404 when disabled) — an explicit, controlled development affordance to be replaced by an admin-only, four-eyes funding operation when admin RBAC lands (Slice 7). It must remain disabled in shared environments.

### 3.2 Admin authorization (back office)

- **Granular RBAC** with named roles: super-admin, compliance/AML officer, fraud analyst, support agent, and read-only auditor.
- **Segregation of duties:** no single role can both initiate and approve a sensitive action.
- **Four-eyes (maker-checker):** high-risk operations (account suspension, fund reversal, limit override, KYC override) are requested by one operator and approved by another.
- **Mandatory admin MFA** and shorter session lifetimes for all back-office access.
- **Scoped access:** admins see only what their role requires; the audited "assist / view-as-customer" mode is explicit, time-boxed, and logged.

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

### 6.2 At rest

- Encryption at rest for databases, object storage, and backups.
- **Field-level encryption / tokenization** for sensitive PII (identity documents, personal identifiers), separating access to sensitive fields from general application data.
- **Envelope encryption** via a KMS abstraction; keys are managed and rotated, never embedded in code or images.

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
| 0.5.0 | 2026-07-13 | Phase 1 Slice 6: append-only, hash-chained audit trail (ADR-0024). Sensitive actions (P2P transfer, dev funding, SCA step-up, session revocation and refresh-reuse revocation, account provisioning) are recorded to an immutable, tamper-evident `audit_log` inside each action's own transaction; one global hash chain verified by `verifyAuditChain`, with the ledger's append-only triggers rejecting UPDATE/DELETE. Records hold internal references only (no raw PII). Dead-session retention tightened from a 90-day forensic grace to prompt purge now that the forensic record lives in the trail; the SCA-grant→session FK set to `ON DELETE CASCADE`. |
| 0.4.0 | 2026-07-12 | Phase 1 Slice 5: PSD2 dynamic linking enforced on the internal P2P transfer (server-side action-hash recomputation, single-use grant consumed atomically in the posting transaction); object-level authorization on the wallet transaction-history read; dev funding faucet documented as a kill-switched, self-scoped interim control until admin RBAC (ADR-0023). |
| 0.3.0 | 2026-07-12 | Phase 1 Slice 4: object-level authorization enforced on the `/v1/accounts` customer resource (session guard + server-side ownership assertion); account provisioning is event-driven and idempotent (ADR-0022). |
| 0.2.0 | 2026-07-06 | Phase 1 Slice 3 controls implemented and annotated: passkey/WebAuthn two-factor ceremonies with anti-enumeration, opaque server-side sessions with immediate revocation (ADR-0020); SCA step-up with dynamic linking, auth rate limiting, and the retention sweeper (ADR-0021). |
| 0.1.0 | 2026-07-04 | Initial security model: identity, authz, KYC/AML, monitoring, data protection, audit, SDLC, threat model. |
