import {
  BASE_CURRENCY,
  Money,
  ValidationError,
  type EventClock,
  type IdGenerator,
  type MoneyJSON,
} from '@fides/domain';
import { buildTransferScaAction } from '@fides/contracts';
import { stableStringify } from '../../../shared/crypto/canonical';
import { sha256Hex } from '../../../shared/crypto/secrets';
import type { Principal } from '../../identity/application/session.service';
import { computeActionHash, consumeScaGrant } from '../../identity/application/sca-grant';
import { WalletResolver } from '../../accounts/application/wallet-resolver';
import { buildJournalEntry } from '../../ledger/domain/journal-entry';
import { PostingDirection } from '../../ledger/domain/account';
import { PostingService } from '../../ledger/application/posting.service';

/** Stable operation name for the transfer idempotency row. */
const TRANSFER_OPERATION = 'p2p_transfer';

export interface TransferCommand {
  readonly principal: Principal;
  /** Recipient account email (normalized at the DTO boundary). */
  readonly recipient: string;
  readonly amount: MoneyJSON;
  /** Single-use SCA grant (fsg_…) from /v1/auth/sca/verify. */
  readonly grant: string;
  /** The `Idempotency-Key` header value. */
  readonly idempotencyKey: string;
}

export interface TransferResult {
  readonly transferId: string;
  readonly amount: Money;
  readonly senderBalance: Money;
  readonly occurredAt: string;
}

/**
 * Internal instant P2P transfer (Slice 5). Debits the sender's wallet and
 * credits the recipient's in one balanced journal entry, guarded so the sender
 * cannot go negative. SCA is enforced under PSD2 dynamic linking: the action
 * hash is recomputed from the executed amount and payee (never trusted from the
 * client) and the single-use grant is consumed inside the posting transaction
 * via the `onClaimed` hook — so a tampered field fails, and an idempotent replay
 * neither re-consumes the grant nor re-posts (ADR-0021/0023).
 */
export class TransferService {
  constructor(
    private readonly posting: PostingService,
    private readonly wallets: WalletResolver,
    private readonly ids: IdGenerator,
    private readonly clock: EventClock,
  ) {}

  async transfer(command: TransferCommand): Promise<TransferResult> {
    const { principal, recipient, grant, idempotencyKey } = command;

    const amount = Money.fromJSON(command.amount);
    if (!amount.isPositive()) {
      throw new ValidationError('Transfer amount must be positive', {
        amount: command.amount.amount,
      });
    }
    if (amount.currency !== BASE_CURRENCY) {
      throw new ValidationError('Only EUR transfers are supported in Phase 1', {
        currency: amount.currency,
      });
    }

    const sender = await this.wallets.resolvePrimaryWallet(principal.userId);
    const payee = await this.wallets.resolveRecipientByEmail(recipient);
    if (payee.ownerUserId === principal.userId) {
      throw new ValidationError('Cannot transfer to your own account');
    }

    // Dynamic linking: rebuild the action from what is actually being executed
    // and hash it server-side, so a client that signed a different amount/payee
    // cannot spend this grant.
    const actionHash = computeActionHash(
      buildTransferScaAction({
        recipient,
        amount: amount.amount.toString(),
        currency: amount.currency,
      }),
    );

    const entry = buildJournalEntry({
      id: this.ids.next(),
      type: 'transfer',
      occurredAt: this.clock.now(),
      postings: [
        { accountId: sender.ledgerAccountId, direction: PostingDirection.Debit, amount },
        { accountId: payee.ledgerAccountId, direction: PostingDirection.Credit, amount },
      ],
    });

    const result = await this.posting.post({
      entry,
      guardAccountIds: [sender.ledgerAccountId],
      idempotency: {
        actorId: principal.userId,
        key: idempotencyKey,
        fingerprint: fingerprintOf(recipient, amount),
        operation: TRANSFER_OPERATION,
      },
      onClaimed: (tx, now) =>
        consumeScaGrant(tx, {
          userId: principal.userId,
          sessionId: principal.sessionId,
          grant,
          actionHash,
          now,
        }),
    });

    const senderBalance = result.balances.find(
      (balance) => balance.accountId === sender.ledgerAccountId,
    );
    return {
      transferId: result.entryId,
      amount,
      senderBalance: Money.fromMinor(BigInt(senderBalance?.balanceMinor ?? '0'), amount.currency),
      occurredAt: result.occurredAt,
    };
  }
}

/**
 * Fingerprint of the linked money parameters (recipient, amount, currency). A
 * reuse of the same idempotency key with different parameters is a conflict; the
 * grant is deliberately excluded (a legitimate retry may carry a fresh one).
 */
function fingerprintOf(recipient: string, amount: Money): string {
  return sha256Hex(
    stableStringify({
      recipient,
      amount: amount.amount.toString(),
      currency: amount.currency,
    }),
  );
}
