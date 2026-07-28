import {
  Money,
  NotFoundError,
  ValidationError,
  type CurrencyCode,
  type EventClock,
} from '@fides/domain';
import { and, asc, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { Database } from '../../../database/db.types';
import { accounts, wallets } from '../../accounts/infra/accounts.schema';
import {
  verifyAuditChain,
  type AuditActorType,
  type AuditVerificationResult,
} from '../../audit/application/audit.service';
import { auditLog, type AuditLogRow } from '../../audit/infra/audit.schema';
import { users } from '../../identity/infra/identity.schema';
import { kycApplications } from '../../kyc/infra/kyc.schema';
import { LedgerStore } from '../../ledger/infra/ledger.repository';
import { ledgerAccounts } from '../../ledger/infra/ledger.schema';

export interface CustomerSummary {
  readonly id: string;
  readonly email: string;
  readonly status: string;
  readonly emailVerified: boolean;
  readonly kycStatus: string | null;
  readonly createdAt: Date;
}

export interface CustomerWalletView {
  readonly id: string;
  readonly currency: CurrencyCode;
  readonly balance: Money;
  /** Exposed to the back office only; never on a customer-facing response. */
  readonly ledgerAccountId: string;
}

export interface CustomerAccountView {
  readonly id: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly wallets: readonly CustomerWalletView[];
}

export interface CustomerDetail extends CustomerSummary {
  readonly givenName: string;
  readonly familyName: string;
  readonly country: string;
  readonly kycReference: string | null;
  readonly kycDecidedAt: Date | null;
  readonly accounts: readonly CustomerAccountView[];
}

export interface CustomerPage {
  readonly items: readonly CustomerSummary[];
  readonly nextCursor: string | null;
}

export interface LedgerAccountView {
  readonly id: string;
  readonly code: string;
  readonly type: string;
  readonly currency: CurrencyCode;
  readonly system: boolean;
  /** The maintained projection (ADR-0019), which the money path reads. */
  readonly projectedBalance: Money;
  /** The same balance recomputed from the raw postings. */
  readonly computedBalance: Money;
  /** True when the two agree — the reconciliation invariant, made operable. */
  readonly reconciled: boolean;
}

export interface AuditRecordView {
  readonly id: string;
  readonly seq: number;
  readonly occurredAt: Date;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly metadata: unknown;
  readonly correlationId: string | null;
  readonly hash: string;
  readonly prevHash: string;
}

export interface AuditPage {
  readonly items: readonly AuditRecordView[];
  readonly nextCursor: string | null;
}

export interface AuditQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly action?: string;
  readonly actorId?: string;
  readonly actorType?: AuditActorType;
}

/**
 * The back-office read surface (ADR-0025): the customer directory, ledger
 * views, and the audit trail deferred from Slice 6.
 *
 * These reads deliberately query the owning modules' tables directly rather
 * than routing through their customer-facing services. Those services are
 * ownership-scoped by construction (`assertResourceOwnership`), and adding an
 * admin bypass to them would put back-office semantics into the customer
 * authorization path — exactly the entanglement the separate admin identity
 * exists to prevent. Authorization for everything here is by capability, checked
 * by `@RequirePermission` at the route.
 */
export class AdminReadService {
  constructor(
    private readonly db: Database,
    private readonly ledger: LedgerStore,
    private readonly clock: EventClock,
  ) {}

  /** The customer directory, newest first, keyset-paginated over `(created_at, id)`. */
  async listCustomers(options: {
    readonly limit: number;
    readonly cursor?: string;
    readonly email?: string;
  }): Promise<CustomerPage> {
    const after = options.cursor ? decodeCursor(options.cursor) : undefined;
    const filters = [
      ...(options.email ? [eq(users.email, options.email.trim().toLowerCase())] : []),
      ...(after
        ? [
            or(
              lt(users.createdAt, after.at),
              and(eq(users.createdAt, after.at), lt(users.id, after.id)),
            )!,
          ]
        : []),
    ];

    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        status: users.status,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
        kycStatus: kycApplications.status,
      })
      .from(users)
      .leftJoin(kycApplications, eq(kycApplications.userId, users.id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(options.limit + 1);

    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.id,
        email: row.email,
        status: row.status,
        emailVerified: row.emailVerifiedAt !== null,
        kycStatus: row.kycStatus,
        createdAt: row.createdAt,
      })),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  /** One customer with their KYC decision, accounts, wallets, and live balances. */
  async getCustomer(userId: string): Promise<CustomerDetail> {
    const [row] = await this.db
      .select({
        user: users,
        kycStatus: kycApplications.status,
        kycReference: kycApplications.reference,
        kycDecidedAt: kycApplications.decidedAt,
      })
      .from(users)
      .leftJoin(kycApplications, eq(kycApplications.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new NotFoundError('Customer not found', { userId });

    const accountRows = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .orderBy(asc(accounts.createdAt));

    const hydrated = await Promise.all(
      accountRows.map(async (account) => {
        const walletRows = await this.db
          .select()
          .from(wallets)
          .where(eq(wallets.accountId, account.id))
          .orderBy(asc(wallets.currency));
        return {
          id: account.id,
          status: account.status,
          createdAt: account.createdAt,
          wallets: await Promise.all(
            walletRows.map(async (wallet) => ({
              id: wallet.id,
              currency: wallet.currency as CurrencyCode,
              balance: await this.ledger.getBalance(wallet.ledgerAccountId),
              ledgerAccountId: wallet.ledgerAccountId,
            })),
          ),
        };
      }),
    );

    return {
      id: row.user.id,
      email: row.user.email,
      status: row.user.status,
      emailVerified: row.user.emailVerifiedAt !== null,
      kycStatus: row.kycStatus,
      createdAt: row.user.createdAt,
      givenName: row.user.givenName,
      familyName: row.user.familyName,
      country: row.user.country,
      kycReference: row.kycReference,
      kycDecidedAt: row.kycDecidedAt,
      accounts: hydrated,
    };
  }

  /** Resolve a wallet to its backing ledger account, for the admin history read. */
  async resolveWalletLedgerAccount(walletId: string): Promise<string> {
    const [row] = await this.db
      .select({ ledgerAccountId: wallets.ledgerAccountId })
      .from(wallets)
      .where(eq(wallets.id, walletId))
      .limit(1);
    if (!row) throw new NotFoundError('Wallet not found', { walletId });
    return row.ledgerAccountId;
  }

  /**
   * A ledger account beside its reconciliation state: the maintained projection
   * and the same figure recomputed from the postings. Surfacing the ADR-0019
   * invariant as an operable view rather than a test-only assertion is the point
   * of the "ledger view" in the Phase 1 admin scope.
   */
  async getLedgerAccount(ledgerAccountId: string): Promise<LedgerAccountView> {
    const [row] = await this.db
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, ledgerAccountId))
      .limit(1);
    if (!row) throw new NotFoundError('Ledger account not found', { ledgerAccountId });

    const reconciliation = await this.ledger.reconcileAccount(ledgerAccountId);
    const currency = row.currency as CurrencyCode;
    return {
      id: row.id,
      code: row.code,
      type: row.type,
      currency,
      system: row.system,
      projectedBalance: Money.fromMinor(reconciliation.projectedMinor, currency),
      computedBalance: Money.fromMinor(reconciliation.computedMinor, currency),
      reconciled: reconciliation.consistent,
    };
  }

  /**
   * The audit trail, newest first, keyset-paginated over the gap-free `seq`.
   * This is the read surface ADR-0024 deferred until the auditor role existed.
   */
  async listAuditRecords(query: AuditQuery): Promise<AuditPage> {
    const after = query.cursor ? decodeSeqCursor(query.cursor) : undefined;
    const filters = [
      ...(query.action ? [eq(auditLog.action, query.action)] : []),
      ...(query.actorId ? [eq(auditLog.actorId, query.actorId)] : []),
      ...(query.actorType ? [eq(auditLog.actorType, query.actorType)] : []),
      ...(after !== undefined ? [lt(auditLog.seq, after)] : []),
    ];

    const rows = await this.db
      .select()
      .from(auditLog)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(auditLog.seq))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map(toAuditView),
      nextCursor: hasMore && last ? String(last.seq) : null,
    };
  }

  /**
   * Walk the whole chain from genesis and confirm its integrity (ADR-0024).
   *
   * Deliberately not range-scoped: only a walk from `seq` 0 can establish that
   * the sequence is gap-free, and a "verified" answer over an arbitrary window
   * would be a weaker claim than the word implies.
   */
  async verifyAudit(): Promise<AuditVerificationResult & { readonly verifiedAt: Date }> {
    const rows = await this.db.select().from(auditLog).orderBy(asc(auditLog.seq));
    return { ...verifyAuditChain(rows), verifiedAt: this.clock.now() };
  }

  /** Count of records on the trail, for the verification summary. */
  async countAuditRecords(): Promise<number> {
    const [row] = await this.db.select({ count: sql<number>`count(*)::int` }).from(auditLog);
    return row?.count ?? 0;
  }
}

function toAuditView(row: AuditLogRow): AuditRecordView {
  return {
    id: row.id,
    seq: row.seq,
    occurredAt: row.occurredAt,
    actorType: row.actorType,
    actorId: row.actorId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    before: row.before,
    after: row.after,
    metadata: row.metadata,
    correlationId: row.correlationId,
    hash: row.hash,
    prevHash: row.prevHash,
  };
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { readonly at: Date; readonly id: string } {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = decoded.indexOf('|');
  const at = new Date(separator >= 0 ? decoded.slice(0, separator) : '');
  const id = separator >= 0 ? decoded.slice(separator + 1) : '';
  if (separator < 0 || id.length === 0 || Number.isNaN(at.getTime())) {
    throw new ValidationError('Malformed pagination cursor', { cursor });
  }
  return { at, id };
}

function decodeSeqCursor(cursor: string): number {
  const seq = Number(cursor);
  if (!Number.isInteger(seq) || seq < 0) {
    throw new ValidationError('Malformed pagination cursor', { cursor });
  }
  return seq;
}
