import { Money } from '@fides/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AccountType, normalBalance, PostingDirection } from './account';
import { buildJournalEntry, sumByCurrency } from './journal-entry';
import { balanceEffectMinor, type Posting } from './posting';

const amount = fc.bigInt({ min: 1n, max: 1_000_000_000n });
const accountType = fc.constantFrom(...Object.values(AccountType));
const direction = fc.constantFrom(PostingDirection.Debit, PostingDirection.Credit);

describe('journal entry invariants (property-based)', () => {
  it('any collection of equal debit/credit pairs builds and nets to zero', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ debit: fc.uuid(), credit: fc.uuid(), value: amount }), {
          minLength: 1,
          maxLength: 25,
        }),
        (pairs) => {
          const postings: Posting[] = pairs.flatMap((pair) => [
            {
              accountId: pair.debit,
              direction: PostingDirection.Debit,
              amount: Money.fromMinor(pair.value, 'EUR'),
            },
            {
              accountId: pair.credit,
              direction: PostingDirection.Credit,
              amount: Money.fromMinor(pair.value, 'EUR'),
            },
          ]);
          const entry = buildJournalEntry({
            id: 'entry',
            type: 'test',
            occurredAt: new Date(0),
            postings,
          });
          return sumByCurrency(entry.postings).get('EUR') === 0n;
        },
      ),
    );
  });

  it('balanceEffectMinor is positive exactly when the posting moves in the normal direction', () => {
    fc.assert(
      fc.property(accountType, direction, amount, (type, dir, value) => {
        const posting: Posting = {
          accountId: 'a',
          direction: dir,
          amount: Money.fromMinor(value, 'EUR'),
        };
        const effect = balanceEffectMinor(posting, type);
        return dir === normalBalance(type) ? effect === value : effect === -value;
      }),
    );
  });
});

describe('unbalanced entries never construct', () => {
  it('rejects a single extra minor unit on one side', () => {
    fc.assert(
      fc.property(amount, (value) => {
        expect(() =>
          buildJournalEntry({
            id: 'bad',
            type: 'test',
            occurredAt: new Date(0),
            postings: [
              {
                accountId: 'a',
                direction: PostingDirection.Debit,
                amount: Money.fromMinor(value + 1n, 'EUR'),
              },
              {
                accountId: 'b',
                direction: PostingDirection.Credit,
                amount: Money.fromMinor(value, 'EUR'),
              },
            ],
          }),
        ).toThrow();
      }),
    );
  });
});
