import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
  type CurrencyCode,
  type EventClock,
  type IdGenerator,
  type MoneyJSON,
} from '@fides/domain';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import type { Database } from '../../../database/db.types';
import { WalletResolver } from '../../accounts/application/wallet-resolver';
import { AuditAction, AuditResource } from '../../audit/application/audit-actions';
import { AuditService } from '../../audit/application/audit.service';
import { FundingService } from '../../payments/application/funding.service';
import {
  pendingAdminActions,
  type PendingAdminActionRow,
  type PendingAdminActionStatus,
} from '../infra/admin.schema';
import type { AdminPrincipal } from './admin-session.service';

/**
 * The only action type registered in Phase 1 (ADR-0025). The table is generic
 * so the Phase 2/3 high-risk actions — suspension, reversal, limit override —
 * join it without a schema change.
 */
export const ADMIN_FUNDING_ACTION = 'admin_funding';

/** How long a request stays approvable before it must be raised again. */
export const PENDING_ACTION_TTL_MS = 24 * 60 * 60 * 1000;

/** The validated payload of an `admin_funding` request. */
export interface AdminFundingPayload {
  /** The beneficiary customer. */
  readonly userId: string;
  /** The wallet resolved at request time, so the checker approves an exact target. */
  readonly walletId: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly reason: string;
}

export interface PendingActionView {
  readonly id: string;
  readonly type: string;
  readonly status: PendingAdminActionStatus;
  readonly payload: AdminFundingPayload;
  readonly makerId: string;
  readonly makerReason: string | null;
  readonly checkerId: string | null;
  readonly decisionReason: string | null;
  readonly decidedAt: Date | null;
  readonly expiresAt: Date;
  /** True when a still-pending request has passed its deadline. */
  readonly expired: boolean;
  /** What executing the action produced — for funding, the journal entry id. */
  readonly resultRef: string | null;
  readonly createdAt: Date;
}

export interface PendingActionPage {
  readonly items: readonly PendingActionView[];
  readonly nextCursor: string | null;
}

export interface RequestFundingInput {
  readonly userId: string;
  readonly amount: MoneyJSON;
  readonly reason: string;
}

export interface ApproveResult {
  readonly action: PendingActionView;
  /** The journal entry the approval posted. */
  readonly fundingId: string;
}

/**
 * The four-eyes (maker-checker) workflow (ADR-0011, ADR-0025).
 *
 * A maker files a request; a different admin, holding the checker permission,
 * approves or rejects it. Segregation of duties is enforced three times over:
 * structurally in the permission matrix (no role holds both halves), here at
 * runtime (`checkerId != makerId`), and by a database CHECK constraint.
 *
 * Approval executes the action **inside the transaction that transitions the
 * row out of `pending`** — the row is locked, checked, and updated within the
 * posting transaction via the funding service's `onAuthorize` hook, so a
 * concurrent double-approval cannot post twice and a failed posting leaves the
 * request pending rather than approved-but-unexecuted.
 */
export class PendingAdminActionService {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
    private readonly clock: EventClock,
    private readonly audit: AuditService,
    private readonly wallets: WalletResolver,
    private readonly funding: FundingService,
    private readonly ttlMs: number = PENDING_ACTION_TTL_MS,
  ) {}

  /**
   * The maker half. Resolves and validates the target up front — a request that
   * could never execute is rejected before it costs a checker any attention —
   * then records it. No money moves.
   */
  async requestFunding(
    admin: AdminPrincipal,
    input: RequestFundingInput,
    correlationId?: string,
  ): Promise<PendingActionView> {
    if (input.reason.trim().length === 0) {
      throw new ValidationError('A reason is required for an admin funding request');
    }

    const wallet = await this.wallets.resolvePrimaryWallet(input.userId);
    const { amount } = await this.funding.validateRequest(wallet.walletId, input.amount);

    const now = this.clock.now();
    const payload: AdminFundingPayload = {
      userId: input.userId,
      walletId: wallet.walletId,
      amountMinor: amount.amount.toString(),
      currency: amount.currency,
      reason: input.reason.trim(),
    };
    const id = this.ids.next();
    const expiresAt = new Date(now.getTime() + this.ttlMs);

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(pendingAdminActions)
        .values({
          id,
          type: ADMIN_FUNDING_ACTION,
          status: 'pending',
          payload,
          makerId: admin.adminId,
          makerReason: payload.reason,
          expiresAt,
          correlationId: correlationId ?? null,
          createdAt: now,
        })
        .returning();

      await this.audit.append(tx, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: AuditAction.AdminFundingRequested,
        resourceType: AuditResource.PendingAdminAction,
        resourceId: id,
        after: {
          status: 'pending',
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          walletId: payload.walletId,
          beneficiaryUserId: payload.userId,
        },
        correlationId: correlationId ?? null,
      });

      return this.toView(row!, now);
    });
  }

  /**
   * The checker half. Posts the funding and transitions the request in one
   * transaction; the authorization checks run under a row lock inside it, so
   * they are decided against the state the posting actually commits against.
   */
  async approve(
    admin: AdminPrincipal,
    actionId: string,
    options: {
      readonly idempotencyKey: string;
      readonly decisionReason?: string;
      readonly correlationId?: string;
    },
  ): Promise<ApproveResult> {
    // Loaded for its payload only. The approval rules are deliberately NOT
    // checked here: a pre-flight status check would reject a retry carrying the
    // original Idempotency-Key, which is precisely the case idempotency exists
    // for (a checker whose approval timed out must get the original result, not
    // a confusing rejection). The authoritative checks run under a row lock
    // inside the posting transaction, which an idempotent replay never enters.
    const existing = await this.requireAction(actionId);
    const payload = existing.payload as AdminFundingPayload;

    const funded = await this.funding.fund({
      actor: { type: 'admin', adminId: admin.adminId },
      targetWalletId: payload.walletId,
      amount: { amount: payload.amountMinor, currency: payload.currency as CurrencyCode },
      idempotencyKey: options.idempotencyKey,
      correlationId: options.correlationId,
      reference: actionId,
      onAuthorize: async (tx, now, entryId) => {
        const [locked] = await tx
          .select()
          .from(pendingAdminActions)
          .where(eq(pendingAdminActions.id, actionId))
          .limit(1)
          .for('update');
        if (!locked) throw new NotFoundError('Pending action not found', { actionId });
        this.assertApprovable(locked, admin, now);

        await tx
          .update(pendingAdminActions)
          .set({
            status: 'approved',
            checkerId: admin.adminId,
            decisionReason: options.decisionReason ?? null,
            decidedAt: now,
            resultRef: entryId,
          })
          .where(eq(pendingAdminActions.id, actionId));

        await this.audit.append(tx, {
          actorType: 'admin',
          actorId: admin.adminId,
          action: AuditAction.AdminFundingApproved,
          resourceType: AuditResource.PendingAdminAction,
          resourceId: actionId,
          before: { status: 'pending' },
          after: {
            status: 'approved',
            makerId: locked.makerId,
            checkerId: admin.adminId,
            journalEntryId: entryId,
            amountMinor: payload.amountMinor,
            currency: payload.currency,
          },
          correlationId: options.correlationId ?? null,
        });
      },
    });

    return {
      action: this.toView(await this.requireAction(actionId), this.clock.now()),
      fundingId: funded.fundingId,
    };
  }

  /** Reject a pending request. Moves no money and cannot be undone. */
  async reject(
    admin: AdminPrincipal,
    actionId: string,
    options: { readonly decisionReason?: string; readonly correlationId?: string } = {},
  ): Promise<PendingActionView> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(pendingAdminActions)
        .where(eq(pendingAdminActions.id, actionId))
        .limit(1)
        .for('update');
      if (!locked) throw new NotFoundError('Pending action not found', { actionId });
      if (locked.status !== 'pending') {
        throw new ValidationError('This request has already been decided', {
          status: locked.status,
        });
      }

      const [row] = await tx
        .update(pendingAdminActions)
        .set({
          status: 'rejected',
          checkerId: admin.adminId,
          decisionReason: options.decisionReason ?? null,
          decidedAt: now,
        })
        .where(eq(pendingAdminActions.id, actionId))
        .returning();

      await this.audit.append(tx, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: AuditAction.AdminFundingRejected,
        resourceType: AuditResource.PendingAdminAction,
        resourceId: actionId,
        before: { status: 'pending' },
        after: { status: 'rejected', makerId: locked.makerId, checkerId: admin.adminId },
        correlationId: options.correlationId ?? null,
      });

      return this.toView(row!, now);
    });
  }

  async get(actionId: string): Promise<PendingActionView> {
    return this.toView(await this.requireAction(actionId), this.clock.now());
  }

  /** The queue, newest first, keyset-paginated over `(created_at, id)`. */
  async list(options: {
    readonly limit: number;
    readonly cursor?: string;
    readonly status?: PendingAdminActionStatus;
  }): Promise<PendingActionPage> {
    const now = this.clock.now();
    const after = options.cursor ? decodeCursor(options.cursor) : undefined;
    const filters = [
      ...(options.status ? [eq(pendingAdminActions.status, options.status)] : []),
      ...(after
        ? [
            or(
              lt(pendingAdminActions.createdAt, after.createdAt),
              and(
                eq(pendingAdminActions.createdAt, after.createdAt),
                lt(pendingAdminActions.id, after.id),
              ),
            )!,
          ]
        : []),
    ];

    const rows = await this.db
      .select()
      .from(pendingAdminActions)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(pendingAdminActions.createdAt), desc(pendingAdminActions.id))
      .limit(options.limit + 1);

    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map((row) => this.toView(row, now)),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  private async requireAction(actionId: string): Promise<PendingAdminActionRow> {
    const [row] = await this.db
      .select()
      .from(pendingAdminActions)
      .where(eq(pendingAdminActions.id, actionId))
      .limit(1);
    if (!row) throw new NotFoundError('Pending action not found', { actionId });
    return row;
  }

  /**
   * The approval rules, evaluated once — under the row lock, inside the posting
   * transaction — so they are decided against the state the posting actually
   * commits against. Self-approval is an authorization failure, not a validation
   * one: it is the segregation-of-duties boundary being enforced.
   */
  private assertApprovable(
    row: PendingAdminActionRow,
    admin: AdminPrincipal,
    now: Date = this.clock.now(),
  ): void {
    if (row.type !== ADMIN_FUNDING_ACTION) {
      throw new ValidationError('Unsupported pending action type', { type: row.type });
    }
    if (row.status !== 'pending') {
      throw new ValidationError('This request has already been decided', { status: row.status });
    }
    if (row.expiresAt.getTime() <= now.getTime()) {
      throw new ValidationError('This request has expired and must be raised again');
    }
    if (row.makerId === admin.adminId) {
      throw new AuthorizationError('A request cannot be approved by the admin who raised it', {
        actionId: row.id,
      });
    }
  }

  private toView(row: PendingAdminActionRow, now: Date): PendingActionView {
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      payload: row.payload as AdminFundingPayload,
      makerId: row.makerId,
      makerReason: row.makerReason,
      checkerId: row.checkerId,
      decisionReason: row.decisionReason,
      decidedAt: row.decidedAt,
      expiresAt: row.expiresAt,
      expired: row.status === 'pending' && row.expiresAt.getTime() <= now.getTime(),
      resultRef: row.resultRef,
      createdAt: row.createdAt,
    };
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { readonly createdAt: Date; readonly id: string } {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = decoded.indexOf('|');
  const createdAt = new Date(separator >= 0 ? decoded.slice(0, separator) : '');
  const id = separator >= 0 ? decoded.slice(separator + 1) : '';
  if (separator < 0 || id.length === 0 || Number.isNaN(createdAt.getTime())) {
    throw new ValidationError('Malformed pagination cursor', { cursor });
  }
  return { createdAt, id };
}
