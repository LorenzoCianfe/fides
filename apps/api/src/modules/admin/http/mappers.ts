import type {
  AdminCustomerDetailDto,
  AdminCustomerPageDto,
  AdminCustomerSummaryDto,
  AdminLedgerAccountDto,
  AdminProfileDto,
  AdminSessionResponseDto,
  AuditPageDto,
  AuditRecordDto,
  PendingActionDto,
  PendingActionPageDto,
} from '@fides/contracts';
import type { AdminRole } from '../infra/admin.schema';
import { PERMISSIONS_BY_ROLE } from '../domain/permissions';
import type {
  AuditPage,
  AuditRecordView,
  CustomerDetail,
  CustomerPage,
  CustomerSummary,
  LedgerAccountView,
} from '../application/admin-read.service';
import type { IssuedAdminSession } from '../application/admin-session.service';
import type {
  PendingActionPage,
  PendingActionView,
} from '../application/pending-admin-action.service';

export function toAdminSessionDto(
  session: IssuedAdminSession,
  role: AdminRole,
): AdminSessionResponseDto {
  return {
    sessionId: session.sessionId,
    adminId: session.adminId,
    role,
    token: session.token,
    idleExpiresAt: session.idleExpiresAt.toISOString(),
    absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
  };
}

export function toAdminProfileDto(admin: {
  readonly id: string;
  readonly email: string;
  readonly role: AdminRole;
  readonly mfaEnrolled: boolean;
  readonly lastLoginAt: Date | null;
}): AdminProfileDto {
  return {
    id: admin.id,
    email: admin.email,
    role: admin.role,
    // The matrix is the authorization source of truth, so the client is told
    // what it may do rather than left to infer capabilities from the role name.
    permissions: [...PERMISSIONS_BY_ROLE[admin.role]],
    mfaEnrolled: admin.mfaEnrolled,
    lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
  };
}

function toCustomerSummaryDto(customer: CustomerSummary): AdminCustomerSummaryDto {
  return {
    id: customer.id,
    email: customer.email,
    status: customer.status as AdminCustomerSummaryDto['status'],
    emailVerified: customer.emailVerified,
    kycStatus: customer.kycStatus as AdminCustomerSummaryDto['kycStatus'],
    createdAt: customer.createdAt.toISOString(),
  };
}

export function toCustomerPageDto(page: CustomerPage): AdminCustomerPageDto {
  return { items: page.items.map(toCustomerSummaryDto), nextCursor: page.nextCursor };
}

export function toCustomerDetailDto(customer: CustomerDetail): AdminCustomerDetailDto {
  return {
    ...toCustomerSummaryDto(customer),
    givenName: customer.givenName,
    familyName: customer.familyName,
    country: customer.country,
    kycReference: customer.kycReference,
    kycDecidedAt: customer.kycDecidedAt?.toISOString() ?? null,
    accounts: customer.accounts.map((account) => ({
      id: account.id,
      status: account.status as AdminCustomerDetailDto['accounts'][number]['status'],
      createdAt: account.createdAt.toISOString(),
      wallets: account.wallets.map((wallet) => ({
        id: wallet.id,
        currency: wallet.currency,
        balance: wallet.balance.toJSON(),
        ledgerAccountId: wallet.ledgerAccountId,
      })),
    })),
  };
}

export function toLedgerAccountDto(account: LedgerAccountView): AdminLedgerAccountDto {
  return {
    id: account.id,
    code: account.code,
    type: account.type as AdminLedgerAccountDto['type'],
    currency: account.currency,
    system: account.system,
    projectedBalance: account.projectedBalance.toJSON(),
    computedBalance: account.computedBalance.toJSON(),
    reconciled: account.reconciled,
  };
}

function toAuditRecordDto(record: AuditRecordView): AuditRecordDto {
  return {
    id: record.id,
    seq: record.seq,
    occurredAt: record.occurredAt.toISOString(),
    actorType: record.actorType as AuditRecordDto['actorType'],
    actorId: record.actorId,
    action: record.action,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    before: record.before,
    after: record.after,
    metadata: record.metadata,
    correlationId: record.correlationId,
    hash: record.hash,
    prevHash: record.prevHash,
  };
}

export function toAuditPageDto(page: AuditPage): AuditPageDto {
  return { items: page.items.map(toAuditRecordDto), nextCursor: page.nextCursor };
}

export function toPendingActionDto(action: PendingActionView): PendingActionDto {
  return {
    id: action.id,
    type: action.type,
    status: action.status,
    payload: action.payload,
    makerId: action.makerId,
    makerReason: action.makerReason,
    checkerId: action.checkerId,
    decisionReason: action.decisionReason,
    decidedAt: action.decidedAt?.toISOString() ?? null,
    expiresAt: action.expiresAt.toISOString(),
    expired: action.expired,
    resultRef: action.resultRef,
    createdAt: action.createdAt.toISOString(),
  };
}

export function toPendingActionPageDto(page: PendingActionPage): PendingActionPageDto {
  return { items: page.items.map(toPendingActionDto), nextCursor: page.nextCursor };
}
