import { describe, expect, it } from 'vitest';
import { adminRoleEnum, type AdminRole } from '../infra/admin.schema';
import {
  AdminPermission,
  PERMISSIONS_BY_ROLE,
  SEGREGATED_PERMISSION_PAIRS,
  hasPermission,
  rolesWithPermission,
  type AdminPermissionName,
} from './permissions';

const ROLES = adminRoleEnum.enumValues;

describe('admin permission matrix', () => {
  it('covers every role in the schema enum, with no extras', () => {
    expect(Object.keys(PERMISSIONS_BY_ROLE).sort()).toEqual([...ROLES].sort());
  });

  it('grants only permissions that exist', () => {
    const known = new Set<string>(Object.values(AdminPermission));
    for (const role of ROLES) {
      for (const permission of PERMISSIONS_BY_ROLE[role]) {
        expect(known.has(permission)).toBe(true);
      }
    }
  });

  it('lists no permission twice for a role', () => {
    for (const role of ROLES) {
      const granted = PERMISSIONS_BY_ROLE[role];
      expect(new Set(granted).size).toBe(granted.length);
    }
  });

  // The invariant this whole matrix exists to hold (ADR-0011, ADR-0025): no
  // single role can both initiate and approve a sensitive action. Widening a
  // role — including super_admin — until it holds both halves fails here.
  it('never grants both halves of a segregated pair to one role', () => {
    for (const [maker, checker] of SEGREGATED_PERMISSION_PAIRS) {
      for (const role of ROLES) {
        const holdsBoth = hasPermission(role, maker) && hasPermission(role, checker);
        expect(holdsBoth, `role ${role} holds both ${maker} and ${checker}`).toBe(false);
      }
    }
  });

  it('leaves both halves of every segregated pair reachable by some role', () => {
    for (const pair of SEGREGATED_PERMISSION_PAIRS) {
      for (const permission of pair) {
        expect(rolesWithPermission(permission).length).toBeGreaterThan(0);
      }
    }
  });

  it('makes super_admin the funding checker and denies it the maker half', () => {
    expect(hasPermission('super_admin', AdminPermission.AdminFundingApprove)).toBe(true);
    expect(hasPermission('super_admin', AdminPermission.AdminFundingRequest)).toBe(false);
    expect(rolesWithPermission(AdminPermission.AdminFundingApprove)).toEqual(['super_admin']);
    expect(rolesWithPermission(AdminPermission.AdminFundingRequest)).toEqual([
      'compliance_officer',
      'support_agent',
    ]);
  });

  it('makes super_admin the second-factor reset checker and denies it the maker half', () => {
    expect(hasPermission('super_admin', AdminPermission.AdminTotpResetApprove)).toBe(true);
    expect(hasPermission('super_admin', AdminPermission.AdminTotpResetRequest)).toBe(false);
    expect(rolesWithPermission(AdminPermission.AdminTotpResetApprove)).toEqual(['super_admin']);
  });

  // Narrower than funding on purpose (ADR-0030): a funding credit is money, but
  // a factor reset hands over a back-office identity, so front-line support may
  // raise the first and not the second.
  it('reserves the second-factor reset maker half to compliance_officer', () => {
    expect(rolesWithPermission(AdminPermission.AdminTotpResetRequest)).toEqual([
      'compliance_officer',
    ]);
    expect(hasPermission('support_agent', AdminPermission.AdminTotpResetRequest)).toBe(false);
  });

  it('reserves back-office staffing to super_admin', () => {
    expect(rolesWithPermission(AdminPermission.AdminsManage)).toEqual(['super_admin']);
  });

  it('keeps auditor strictly read-only', () => {
    const writePermissions: AdminPermissionName[] = [
      AdminPermission.AdminFundingRequest,
      AdminPermission.AdminFundingApprove,
      AdminPermission.AdminTotpResetRequest,
      AdminPermission.AdminTotpResetApprove,
      AdminPermission.AdminsManage,
    ];
    for (const permission of writePermissions) {
      expect(hasPermission('auditor', permission)).toBe(false);
    }
    expect(hasPermission('auditor', AdminPermission.AuditRead)).toBe(true);
  });

  it('gates the audit trail behind auditor-or-higher, not every role', () => {
    expect(rolesWithPermission(AdminPermission.AuditRead).sort()).toEqual(
      (['auditor', 'compliance_officer', 'fraud_analyst', 'super_admin'] as AdminRole[]).sort(),
    );
    expect(hasPermission('support_agent', AdminPermission.AuditRead)).toBe(false);
  });
});
