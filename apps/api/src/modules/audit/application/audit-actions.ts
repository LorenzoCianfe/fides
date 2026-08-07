/**
 * Stable, namespaced discriminators for the sensitive actions recorded in the
 * audit trail (ADR-0024). Kept central so callers and tests never stringly-type
 * an action name, and the wired set is enumerable in one place.
 */
export const AuditAction = {
  /** A completed internal P2P transfer (money moved). */
  TransferExecuted: 'p2p_transfer.executed',
  /** A completed admin funding credit from settlement (money moved). */
  AdminFundingExecuted: 'admin_funding.executed',
  /** A single-use SCA step-up grant was minted for an action. */
  ScaStepUpGranted: 'sca.step_up.granted',
  /** A session was revoked (logout or explicit per-device revoke). */
  SessionRevoked: 'session.revoked',
  /** A session was revoked because a superseded refresh token was reused. */
  SessionRefreshReuseRevoked: 'session.refresh_reuse_revoked',
  /** A customer account (+ wallet + ledger account) was provisioned on KYC approval. */
  AccountProvisioned: 'account.provisioned',

  // --- Back office (ADR-0025); every one carries actor_type 'admin' ----------
  /** The first super_admin was seeded from configuration (a `system` actor). */
  AdminSeeded: 'admin.seeded',
  /** A super_admin created another back-office operator. */
  AdminCreated: 'admin.created',
  /** A back-office operator was disabled or re-enabled. */
  AdminStatusChanged: 'admin.status_changed',
  /** Both admin factors satisfied; a back-office session was issued. */
  AdminSessionIssued: 'admin.session.issued',
  /** A back-office session was revoked (logout or explicit revoke). */
  AdminSessionRevoked: 'admin.session.revoked',
  /** An admin activated their TOTP second factor. */
  AdminMfaEnrolled: 'admin.mfa.enrolled',
  /** An admin rotated their own password (ADR-0030). */
  AdminPasswordChanged: 'admin.password.changed',
  /**
   * An admin's second factor was cleared by an approved four-eyes reset
   * (ADR-0030). Distinct from the approval record: this one is written against
   * the *target* admin, so their history shows the factor changing hands, while
   * the approval is written against the pending action.
   */
  AdminMfaReset: 'admin.mfa.reset',
  /**
   * A back-office authentication attempt was denied (ADR-0029). The exception
   * to ADR-0024's "audit inside the action's transaction": a denial has no
   * transaction to be atomic with — the TOTP step deliberately rolls its own
   * back — so this is written in a separate transaction immediately after.
   * Recorded only for a *known* admin, since an unknown email is PII and has no
   * resource to reference; unknown-address volume is bounded by the throttle.
   */
  AdminAuthDenied: 'admin.auth.denied',
  /** Consecutive failures reached the threshold and the account locked. */
  AdminLocked: 'admin.locked',
  /** A maker requested an admin funding credit (no money moved yet). */
  AdminFundingRequested: 'admin_funding.requested',
  /** A checker approved a funding request; the credit posted in the same transaction. */
  AdminFundingApproved: 'admin_funding.approved',
  /** A checker rejected a funding request; no money moved. */
  AdminFundingRejected: 'admin_funding.rejected',
  /** A maker requested a reset of another operator's second factor (ADR-0030). */
  AdminTotpResetRequested: 'admin_totp_reset.requested',
  /** A checker approved a reset; the factor was cleared in the same transaction. */
  AdminTotpResetApproved: 'admin_totp_reset.approved',
  /** A checker rejected a reset; the target's factor is untouched. */
  AdminTotpResetRejected: 'admin_totp_reset.rejected',
} as const;

export type AuditActionName = (typeof AuditAction)[keyof typeof AuditAction];

/** Target resource kinds referenced by audit records. */
export const AuditResource = {
  JournalEntry: 'journal_entry',
  ScaGrant: 'sca_grant',
  Session: 'session',
  Account: 'account',
  Admin: 'admin',
  AdminSession: 'admin_session',
  PendingAdminAction: 'pending_admin_action',
} as const;
