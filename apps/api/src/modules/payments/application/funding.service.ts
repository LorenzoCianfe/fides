import {
  BASE_CURRENCY,
  Money,
  NotFoundError,
  ValidationError,
  type EventClock,
  type IdGenerator,
  type MoneyJSON,
} from '@fides/domain';
import { stableStringify } from '../../../shared/crypto/canonical';
import { sha256Hex } from '../../../shared/crypto/secrets';
import type { Principal } from '../../identity/application/session.service';
import { WalletResolver } from '../../accounts/application/wallet-resolver';
import { AuditAction, AuditResource } from '../../audit/application/audit-actions';
import { AuditService } from '../../audit/application/audit.service';
import { PostingService } from '../../ledger/application/posting.service';
import { buildJournalEntry } from '../../ledger/domain/journal-entry';
import { PostingDirection } from '../../ledger/domain/account';
import { LedgerStore } from '../../ledger/infra/ledger.repository';

/** Ledger code for the platform settlement (asset) account funding draws from. */
const SETTLEMENT_CODE = 'system:settlement';
const FUNDING_OPERATION = 'dev_funding';

/** Kill-switch and cap for the dev funding faucet (ADR-0023). */
export interface FundingConfig {
  readonly enabled: boolean;
  /** Maximum minor units a single funding request may credit. */
  readonly maxMinor: bigint;
}

export interface FundingCommand {
  readonly principal: Principal;
  readonly amount: MoneyJSON;
  readonly idempotencyKey: string;
  /** Correlation id from the request, recorded on the audit trail (ADR-0024). */
  readonly correlationId?: string;
}

export interface FundingResult {
  readonly fundingId: string;
  readonly amount: Money;
  readonly balance: Money;
  readonly occurredAt: string;
}

/**
 * Dev/admin funding faucet (Slice 5). Credits the caller's own wallet from
 * `system:settlement` (asset, unguarded — it may go negative, ADR-0019) with a
 * balanced journal entry. A development affordance behind a kill-switch until
 * admin RBAC (Slice 7); no SCA, since crediting one's own wallet is not a PSD2
 * payment. Money-moving, so still idempotent on the Idempotency-Key.
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

  async fund(command: FundingCommand): Promise<FundingResult> {
    if (!this.config.enabled) {
      throw new NotFoundError('Funding is disabled');
    }

    const amount = Money.fromJSON(command.amount);
    if (!amount.isPositive()) {
      throw new ValidationError('Funding amount must be positive', {
        amount: command.amount.amount,
      });
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

    const wallet = await this.wallets.resolvePrimaryWallet(command.principal.userId);
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
        actorId: command.principal.userId,
        key: command.idempotencyKey,
        fingerprint: sha256Hex(
          stableStringify({ amount: amount.amount.toString(), currency: amount.currency }),
        ),
        operation: FUNDING_OPERATION,
      },
      // Audit the executed funding atomically, after all ledger writes (ADR-0024).
      onPosted: (tx, _now, posted) =>
        this.audit.append(tx, {
          actorType: 'user',
          actorId: command.principal.userId,
          action: AuditAction.DevFundingExecuted,
          resourceType: AuditResource.JournalEntry,
          resourceId: entry.id,
          correlationId: command.correlationId ?? null,
          metadata: {
            amountMinor: amount.amount.toString(),
            currency: amount.currency,
            walletId: wallet.walletId,
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
