import {
  InternalError,
  Money,
  NotFoundError,
  type CurrencyCode,
  type IdGenerator,
} from '@fides/domain';
import { eq } from 'drizzle-orm';
import type { Database } from '../../../database/db.types';
import { normalBalance, type AccountType, type LedgerAccount } from '../domain';
import { balances, ledgerAccounts, postings, type LedgerAccountRow } from './ledger.schema';

export interface CreateLedgerAccountInput {
  readonly id?: string;
  readonly type: AccountType;
  readonly currency: CurrencyCode;
  readonly code: string;
  readonly system: boolean;
}

export interface ReconciliationResult {
  readonly accountId: string;
  /** Balance held by the projection row. */
  readonly projectedMinor: bigint;
  /** Balance recomputed from the account's postings. */
  readonly computedMinor: bigint;
  readonly consistent: boolean;
}

/**
 * Persistence for ledger accounts and the balance projection, plus read-side
 * reconciliation. The transactional posting path lives in `PostingService`.
 */
export class LedgerStore {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
  ) {}

  /** Create a ledger account and its zero-balance projection row atomically. */
  async createAccount(input: CreateLedgerAccountInput): Promise<LedgerAccount> {
    const id = input.id ?? this.ids.next();
    await this.db.transaction(async (tx) => {
      await tx.insert(ledgerAccounts).values({
        id,
        type: input.type,
        currency: input.currency,
        code: input.code,
        system: input.system,
      });
      await tx.insert(balances).values({ accountId: id, balance: '0', currency: input.currency });
    });
    return {
      id,
      type: input.type,
      currency: input.currency,
      code: input.code,
      system: input.system,
    };
  }

  /** Idempotently ensure a system account exists, returning it either way. */
  async ensureSystemAccount(
    input: Omit<CreateLedgerAccountInput, 'system' | 'id'>,
  ): Promise<LedgerAccount> {
    const existing = await this.findAccountByCode(input.code);
    if (existing) return existing;
    try {
      return await this.createAccount({ ...input, system: true });
    } catch {
      const row = await this.findAccountByCode(input.code);
      if (!row) throw new InternalError('Failed to ensure system account', { code: input.code });
      return row;
    }
  }

  async findAccountByCode(code: string): Promise<LedgerAccount | null> {
    const [row] = await this.db
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.code, code))
      .limit(1);
    return row ? this.toAccount(row) : null;
  }

  async findAccountById(id: string): Promise<LedgerAccount | null> {
    const [row] = await this.db
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, id))
      .limit(1);
    return row ? this.toAccount(row) : null;
  }

  /** Read the projected balance of an account as a `Money` value. */
  async getBalance(accountId: string): Promise<Money> {
    const [row] = await this.db
      .select()
      .from(balances)
      .where(eq(balances.accountId, accountId))
      .limit(1);
    if (!row) throw new NotFoundError('No balance projection for account', { accountId });
    return Money.fromMinor(BigInt(row.balance), row.currency as CurrencyCode);
  }

  /**
   * Recompute an account's balance from its postings and compare it to the
   * projection. `consistent` must always be true; a mismatch signals a defect.
   */
  async reconcileAccount(accountId: string): Promise<ReconciliationResult> {
    const account = await this.findAccountById(accountId);
    if (!account) throw new NotFoundError('Ledger account not found', { accountId });

    const [balanceRow] = await this.db
      .select({ balance: balances.balance })
      .from(balances)
      .where(eq(balances.accountId, accountId))
      .limit(1);
    if (!balanceRow) throw new NotFoundError('No balance projection for account', { accountId });
    const projectedMinor = BigInt(balanceRow.balance);

    const postingRows = await this.db
      .select({ direction: postings.direction, amount: postings.amount })
      .from(postings)
      .where(eq(postings.accountId, accountId));

    const normal = normalBalance(account.type);
    let computedMinor = 0n;
    for (const posting of postingRows) {
      computedMinor += posting.direction === normal ? posting.amount : -posting.amount;
    }

    return {
      accountId,
      projectedMinor,
      computedMinor,
      consistent: projectedMinor === computedMinor,
    };
  }

  /**
   * Signed sum of every posting per currency. The whole-ledger invariant: each
   * balanced entry contributes zero, so every currency must net to zero.
   */
  async sumSignedByCurrency(): Promise<Map<string, bigint>> {
    const rows = await this.db
      .select({
        direction: postings.direction,
        amount: postings.amount,
        currency: postings.currency,
      })
      .from(postings);
    const totals = new Map<string, bigint>();
    for (const row of rows) {
      const signed = row.direction === 'debit' ? row.amount : -row.amount;
      totals.set(row.currency, (totals.get(row.currency) ?? 0n) + signed);
    }
    return totals;
  }

  private toAccount(row: LedgerAccountRow): LedgerAccount {
    return {
      id: row.id,
      type: row.type as AccountType,
      currency: row.currency as CurrencyCode,
      code: row.code,
      system: row.system,
    };
  }
}
