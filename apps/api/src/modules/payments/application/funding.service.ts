import {
  BASE_CURRENCY,
  Money,
  ValidationError,
  type EventClock,
  type IdGenerator,
  type MoneyJSON,
} from '@fides/domain';
import type { DatabaseTx } from '../../../database/db.types';
import { stableStringify } from '../../../shared/crypto/canonical';
import { sha256Hex } from '../../../shared/crypto/secrets';
import { WalletResolver, type ResolvedWallet } from '../../accounts/application/wallet-resolver';
import { AuditAction, AuditResource } from '../../audit/application/audit-actions';
import { AuditService } from '../../audit/application/audit.service';
import { PostingService } from '../../ledger/application/posting.service';
import { buildJournalEntry } from '../../ledger/domain/journal-entry';
import { PostingDirection } from '../../ledger/domain/account';
import { LedgerStore } from '../../ledger/infra/ledger.repository';

/** Ledger code for the platform settlement (asset) account funding draws from. */
const SETTLEMENT_CODE = 'system:settlement';
const FUNDING_OPERATION = 'admin_funding';

/** The back-office operator on whose authority the credit posts (ADR-0025). */
export interface FundingActor {
  readonly type: 'admin';
  readonly adminId: string;
}

/** Blast-radius limit on a single credit; no longer a feature kill-switch. */
export interface FundingConfig {
  /** Maximum minor units a single funding operation may credit. */
  readonly maxMinor: bigint;
}

export interface FundingCommand {
  readonly actor: FundingActor;
  /** The wallet to credit, already resolved and authorized by the caller. */
  readonly targetWalletId: string;
  readonly amount: MoneyJSON;
  readonly idempotencyKey: string;
  /** Correlation id from the request, recorded on the audit trail (ADR-0024). */
  readonly correlationId?: string;
  /** Internal reference for the trail, e.g. the approved pending-action id. */
  readonly reference?: string;
  /**
   * Authorization step run inside the posting transaction, after the
   * idempotency claim and before any ledger write, carrying the journal entry
   * id that is about to post. The four-eyes approval transition rides here
   * (ADR-0025), so an already-decided, expired, or concurrently-approved
   * request rolls the whole posting back and no value moves.
   */
  readonly onAuthorize?: (tx: DatabaseTx, now: Date, entryId: string) => Promise<void>;
}

export interface FundingResult {
  readonly fundingId: string;
  readonly amount: Money;
  readonly balance: Money;
  readonly occurredAt: string;
}

/**
 * Funding: credits a customer wallet from `system:settlement` (asset, unguarded
 * — it may go negative, ADR-0019) with a balanced journal entry.
 *
 * Slice 5 exposed this as a self-service dev faucet behind a kill-switch; Slice 7
 * retired that route (ADR-0025). The operation is now admin-only and reached
 * exclusively through the four-eyes workflow: a maker requests it, a checker
 * approves it, and the approval executes here inside one transaction. The
 * kill-switch is gone because authorization now comes from role, four-eyes, and
 * audit rather than from configuration; the per-request cap remains as a
 * blast-radius limit. Money-moving, so still idempotent on the Idempotency-Key.
 */
export class FundingService {
  constructor(
    private readonly ledger: LedgerStore,
    private readonly posting: PostingService,
    private readonly wallets: WalletResolver,
    private readonly ids: IdGenerator,
    private readonly clock: EventClock,
    private readonly config: FundingConfig,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every rule a funding operation must satisfy, with no side effect. The
   * four-eyes maker calls this at request time so a request that could never
   * execute is rejected before it reaches a checker, and {@link fund} calls it
   * again at execution — so the rules live in exactly one place.
   */
  async validateRequest(
    targetWalletId: string,
    amountJson: MoneyJSON,
  ): Promise<{ readonly amount: Money; readonly wallet: ResolvedWallet }> {
    const amount = Money.fromJSON(amountJson);
    if (!amount.isPositive()) {
      throw new ValidationError('Funding amount must be positive', { amount: amountJson.amount });
    }
    if (amount.currency !== BASE_CURRENCY) {
      throw new ValidationError('Only EUR funding is supported in Phase 1', {
        currency: amount.currency,
      });
    }
    if (amount.amount > this.config.maxMinor) {
      throw new ValidationError('Funding amount exceeds the permitted maximum', {
        maxMinor: this.config.maxMinor.toString(),
      });
    }

    const wallet = await this.wallets.resolveWallet(targetWalletId);
    if (wallet.currency !== amount.currency) {
      throw new ValidationError('Wallet currency does not match the funding amount', {
        walletCurrency: wallet.currency,
        currency: amount.currency,
      });
    }
    return { amount, wallet };
  }

  async fund(command: FundingCommand): Promise<FundingResult> {
    const { amount, wallet } = await this.validateRequest(command.targetWalletId, command.amount);

    const settlement = await this.ledger.ensureSystemAccount({
      type: 'asset',
      currency: BASE_CURRENCY,
      code: SETTLEMENT_CODE,
    });

    const entry = buildJournalEntry({
      id: this.ids.next(),
      type: 'funding',
      occurredAt: this.clock.now(),
      postings: [
        { accountId: settlement.id, direction: PostingDirection.Debit, amount },
        { accountId: wallet.ledgerAccountId, direction: PostingDirection.Credit, amount },
      ],
    });

    const result = await this.posting.post({
      entry,
      guardAccountIds: [],
      idempotency: {
        actorId: command.actor.adminId,
        key: command.idempotencyKey,
        fingerprint: sha256Hex(
          stableStringify({
            walletId: wallet.walletId,
            amount: amount.amount.toString(),
            currency: amount.currency,
          }),
        ),
        operation: FUNDING_OPERATION,
      },
      // The caller's authorization runs first, so the approval it records and the
      // money it releases commit or roll back as one (ADR-0025).
      ...(command.onAuthorize
        ? { onClaimed: (tx, now) => command.onAuthorize!(tx, now, entry.id) }
        : {}),
      // Audit the executed funding atomically, after all ledger writes (ADR-0024).
      onPosted: (tx, _now, posted) =>
        this.audit.append(tx, {
          actorType: 'admin',
          actorId: command.actor.adminId,
          action: AuditAction.AdminFundingExecuted,
          resourceType: AuditResource.JournalEntry,
          resourceId: entry.id,
          correlationId: command.correlationId ?? null,
          metadata: {
            amountMinor: amount.amount.toString(),
            currency: amount.currency,
            walletId: wallet.walletId,
            beneficiaryUserId: wallet.ownerUserId,
            ...(command.reference !== undefined ? { reference: command.reference } : {}),
            balanceAfterMinor:
              posted.balances.find((balance) => balance.accountId === wallet.ledgerAccountId)
                ?.balanceMinor ?? null,
          },
        }),
    });

    const walletBalance = result.balances.find(
      (balance) => balance.accountId === wallet.ledgerAccountId,
    );
    return {
      fundingId: result.entryId,
      amount,
      balance: Money.fromMinor(BigInt(walletBalance?.balanceMinor ?? '0'), amount.currency),
      occurredAt: result.occurredAt,
    };
  }
}
