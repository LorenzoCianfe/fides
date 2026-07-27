/**
 * Stable, namespaced discriminators for the sensitive actions recorded in the
 * audit trail (ADR-0024). Kept central so callers and tests never stringly-type
 * an action name, and the wired set is enumerable in one place.
 */
export const AuditAction = {
  /** A completed internal P2P transfer (money moved). */
  TransferExecuted: 'p2p_transfer.executed',
  /** A completed dev-funding credit from settlement. */
  DevFundingExecuted: 'dev_funding.executed',
  /** A single-use SCA step-up grant was minted for an action. */
  ScaStepUpGranted: 'sca.step_up.granted',
  /** A session was revoked (logout or explicit per-device revoke). */
  SessionRevoked: 'session.revoked',
  /** A session was revoked because a superseded refresh token was reused. */
  SessionRefreshReuseRevoked: 'session.refresh_reuse_revoked',
  /** A customer account (+ wallet + ledger account) was provisioned on KYC approval. */
  AccountProvisioned: 'account.provisioned',
} as const;

export type AuditActionName = (typeof AuditAction)[keyof typeof AuditAction];

/** Target resource kinds referenced by audit records. */
export const AuditResource = {
  JournalEntry: 'journal_entry',
  ScaGrant: 'sca_grant',
  Session: 'session',
  Account: 'account',
} as const;
