import type { AdminRole } from '../infra/admin.schema';

/**
 * The capabilities a back-office role may hold (ADR-0011, ADR-0025). Kept as a
 * closed set in code rather than in the database: this is a policy invariant
 * that must be reviewable in diffs and testable, not operational data a
 * privileged statement could widen silently.
 */
export const AdminPermission = {
  /** Read the customer directory and customer detail. */
  CustomersRead: 'customers.read',
  /** Read any wallet's transaction history, unscoped by ownership. */
  WalletsRead: 'wallets.read',
  /** Read ledger accounts and their reconciliation state. */
  LedgerRead: 'ledger.read',
  /** Read and verify the append-only audit trail (ADR-0024). */
  AuditRead: 'audit.read',
  /** See the four-eyes queue. */
  PendingActionsRead: 'pending_actions.read',
  /**
   * Create, list, and disable back-office operators. Held by `super_admin`
   * alone: staffing the back office is what makes four-eyes possible at all, so
   * it is the one genuinely administrative capability in Phase 1.
   */
  AdminsManage: 'admins.manage',
  /** Initiate an admin funding request (the maker half). */
  AdminFundingRequest: 'admin_funding.request',
  /** Approve or reject an admin funding request (the checker half). */
  AdminFundingApprove: 'admin_funding.approve',
} as const;

export type AdminPermissionName = (typeof AdminPermission)[keyof typeof AdminPermission];

/**
 * Permission pairs that no single role may hold, so that "no single role can
 * both initiate and approve a sensitive action" (ADR-0011) is a structural
 * property of this table rather than a convention. Asserted by a unit test, so
 * widening a role until it holds both halves fails the build.
 */
export const SEGREGATED_PERMISSION_PAIRS: ReadonlyArray<
  readonly [AdminPermissionName, AdminPermissionName]
> = [[AdminPermission.AdminFundingRequest, AdminPermission.AdminFundingApprove]];

/**
 * The role → permission matrix. One role per admin in Phase 1.
 *
 * Note that `super_admin` holds every permission **except**
 * `admin_funding.request`: it is the checker for admin funding and therefore
 * must not be able to be the maker. That is deliberate and is what keeps the
 * segregation-of-duties invariant above true; the runtime `checkerId != makerId`
 * check in the pending-action service is the secondary defence.
 */
export const PERMISSIONS_BY_ROLE: Readonly<Record<AdminRole, readonly AdminPermissionName[]>> = {
  super_admin: [
    AdminPermission.CustomersRead,
    AdminPermission.WalletsRead,
    AdminPermission.LedgerRead,
    AdminPermission.AuditRead,
    AdminPermission.PendingActionsRead,
    AdminPermission.AdminFundingApprove,
    AdminPermission.AdminsManage,
  ],
  compliance_officer: [
    AdminPermission.CustomersRead,
    AdminPermission.WalletsRead,
    AdminPermission.LedgerRead,
    AdminPermission.AuditRead,
    AdminPermission.PendingActionsRead,
    AdminPermission.AdminFundingRequest,
  ],
  fraud_analyst: [
    AdminPermission.CustomersRead,
    AdminPermission.WalletsRead,
    AdminPermission.LedgerRead,
    AdminPermission.AuditRead,
    AdminPermission.PendingActionsRead,
  ],
  support_agent: [
    AdminPermission.CustomersRead,
    AdminPermission.WalletsRead,
    AdminPermission.PendingActionsRead,
    AdminPermission.AdminFundingRequest,
  ],
  /** Read-only oversight: sees everything, changes nothing. */
  auditor: [
    AdminPermission.CustomersRead,
    AdminPermission.WalletsRead,
    AdminPermission.LedgerRead,
    AdminPermission.AuditRead,
    AdminPermission.PendingActionsRead,
  ],
};

/** True if `role` holds `permission`. */
export function hasPermission(role: AdminRole, permission: AdminPermissionName): boolean {
  return PERMISSIONS_BY_ROLE[role].includes(permission);
}

/** Every role holding `permission` — the readable form of "who can do this". */
export function rolesWithPermission(permission: AdminPermissionName): AdminRole[] {
  return (Object.keys(PERMISSIONS_BY_ROLE) as AdminRole[]).filter((role) =>
    hasPermission(role, permission),
  );
}
