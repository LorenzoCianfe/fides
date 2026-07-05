import {
  InvalidJournalEntryError,
  Money,
  UnbalancedEntryError,
  type CurrencyCode,
} from '@fides/domain';
import { describe, expect, it } from 'vitest';
import {
  AccountType,
  balanceEffectMinor,
  normalBalance,
  PostingDirection,
  signedMinor,
} from './index';
import { buildJournalEntry, sumByCurrency } from './journal-entry';
import type { Posting } from './posting';

const eur = (minor: bigint | number): Money => Money.fromMinor(minor, 'EUR');

function debit(accountId: string, amount: Money): Posting {
  return { accountId, direction: PostingDirection.Debit, amount };
}
function credit(accountId: string, amount: Money): Posting {
  return { accountId, direction: PostingDirection.Credit, amount };
}

describe('normalBalance', () => {
  it('maps assets and expenses to debit-normal', () => {
    expect(normalBalance(AccountType.Asset)).toBe(PostingDirection.Debit);
    expect(normalBalance(AccountType.Expense)).toBe(PostingDirection.Debit);
  });

  it('maps liabilities, equity, and income to credit-normal', () => {
    expect(normalBalance(AccountType.Liability)).toBe(PostingDirection.Credit);
    expect(normalBalance(AccountType.Equity)).toBe(PostingDirection.Credit);
    expect(normalBalance(AccountType.Income)).toBe(PostingDirection.Credit);
  });
});

describe('signedMinor', () => {
  it('counts debits positive and credits negative', () => {
    expect(signedMinor(debit('a', eur(100)))).toBe(100n);
    expect(signedMinor(credit('a', eur(100)))).toBe(-100n);
  });
});

describe('balanceEffectMinor', () => {
  it('credits increase a liability (wallet) and debits decrease it', () => {
    expect(balanceEffectMinor(credit('w', eur(500)), AccountType.Liability)).toBe(500n);
    expect(balanceEffectMinor(debit('w', eur(200)), AccountType.Liability)).toBe(-200n);
  });

  it('debits increase an asset and credits decrease it', () => {
    expect(balanceEffectMinor(debit('cash', eur(500)), AccountType.Asset)).toBe(500n);
    expect(balanceEffectMinor(credit('cash', eur(200)), AccountType.Asset)).toBe(-200n);
  });
});

describe('buildJournalEntry', () => {
  const occurredAt = new Date('2026-07-05T00:00:00.000Z');

  it('builds a balanced two-posting transfer', () => {
    const entry = buildJournalEntry({
      id: 'entry-1',
      type: 'transfer',
      occurredAt,
      postings: [debit('wallet:sender', eur(2500)), credit('wallet:recipient', eur(2500))],
    });
    expect(entry.postings).toHaveLength(2);
    expect([...sumByCurrency(entry.postings).values()]).toEqual([0n]);
  });

  it('builds a balanced entry with a split across multiple credits', () => {
    const entry = buildJournalEntry({
      id: 'entry-2',
      type: 'funding',
      occurredAt,
      postings: [
        debit('system:settlement', eur(1000)),
        credit('wallet:a', eur(600)),
        credit('wallet:b', eur(400)),
      ],
    });
    expect(entry.postings).toHaveLength(3);
    expect(sumByCurrency(entry.postings).get('EUR')).toBe(0n);
  });

  it('rejects an entry whose debits do not equal its credits', () => {
    expect(() =>
      buildJournalEntry({
        id: 'bad-1',
        type: 'transfer',
        occurredAt,
        postings: [debit('wallet:sender', eur(2500)), credit('wallet:recipient', eur(2400))],
      }),
    ).toThrow(UnbalancedEntryError);
  });

  it('rejects an entry with fewer than two postings', () => {
    expect(() =>
      buildJournalEntry({
        id: 'bad-2',
        type: 'transfer',
        occurredAt,
        postings: [debit('wallet:sender', eur(2500))],
      }),
    ).toThrow(InvalidJournalEntryError);
  });

  it('rejects a non-positive posting amount', () => {
    expect(() =>
      buildJournalEntry({
        id: 'bad-3',
        type: 'transfer',
        occurredAt,
        postings: [debit('wallet:sender', eur(0)), credit('wallet:recipient', eur(0))],
      }),
    ).toThrow(InvalidJournalEntryError);
  });

  it('balances each currency independently in a mixed entry', () => {
    const usd = (minor: number): Money => Money.fromMinor(minor, 'USD' as CurrencyCode);
    const entry = buildJournalEntry({
      id: 'entry-3',
      type: 'transfer',
      occurredAt,
      postings: [
        debit('wallet:a-eur', eur(1000)),
        credit('wallet:b-eur', eur(1000)),
        debit('wallet:a-usd', usd(500)),
        credit('wallet:b-usd', usd(500)),
      ],
    });
    const totals = sumByCurrency(entry.postings);
    expect(totals.get('EUR')).toBe(0n);
    expect(totals.get('USD')).toBe(0n);
  });

  it('rejects when one currency balances but another does not', () => {
    const usd = (minor: number): Money => Money.fromMinor(minor, 'USD' as CurrencyCode);
    expect(() =>
      buildJournalEntry({
        id: 'bad-4',
        type: 'transfer',
        occurredAt,
        postings: [
          debit('wallet:a-eur', eur(1000)),
          credit('wallet:b-eur', eur(1000)),
          debit('wallet:a-usd', usd(500)),
          credit('wallet:b-usd', usd(499)),
        ],
      }),
    ).toThrow(UnbalancedEntryError);
  });

  it('preserves optional correlation id and metadata', () => {
    const entry = buildJournalEntry({
      id: 'entry-4',
      type: 'transfer',
      occurredAt,
      postings: [debit('wallet:sender', eur(100)), credit('wallet:recipient', eur(100))],
      correlationId: 'corr-123',
      metadata: { transferId: 'tx-1' },
    });
    expect(entry.correlationId).toBe('corr-123');
    expect(entry.metadata).toEqual({ transferId: 'tx-1' });
  });
});
