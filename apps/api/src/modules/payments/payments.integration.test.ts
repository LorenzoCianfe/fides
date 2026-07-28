import { afterAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDatabase } from '../../../test/db';
import { UuidV7Generator } from '../../shared/ids/uuid-v7';
import { SystemClock } from '../../shared/time/system-clock';
import { WalletResolver } from '../accounts/application/wallet-resolver';
import { AuditService } from '../audit/application/audit.service';
import { PostingService } from '../ledger/application/posting.service';
import { LedgerStore } from '../ledger/infra/ledger.repository';
import { FundingService, type FundingConfig } from './application/funding.service';

const ids = new UuidV7Generator();
const clock = new SystemClock();
const { db, close } = createTestDb();

const ledger = new LedgerStore(db as TestDatabase, ids);
const posting = new PostingService(db as TestDatabase, ids, clock);
const wallets = new WalletResolver(db as TestDatabase);
const audit = new AuditService(db as TestDatabase, ids, clock);

const actor = { type: 'admin' as const, adminId: '00000000-0000-7000-8000-000000000001' };
const UNKNOWN_WALLET = '00000000-0000-7000-8000-0000000000ff';

function fundingService(config: FundingConfig): FundingService {
  return new FundingService(ledger, posting, wallets, ids, clock, config, audit);
}

function eur(minor: string) {
  return { amount: minor, currency: 'EUR' as const };
}

/**
 * The funding amount rules short-circuit before any wallet or ledger work, so
 * these assertions need no provisioned state. Since Slice 7 they are shared by
 * both entry points: the four-eyes maker calls `validateRequest` when filing a
 * request, and `fund` re-applies them at execution — the point of keeping the
 * rules in one place. The money path itself is proven end to end, through the
 * real approval journey, in the admin HTTP suite.
 */
describe('admin funding validation (integration)', () => {
  afterAll(async () => {
    await close();
  });

  it('rejects an amount above the configured maximum', async () => {
    const service = fundingService({ maxMinor: 1_000n });
    await expect(service.validateRequest(UNKNOWN_WALLET, eur('2000'))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      service.fund({
        actor,
        targetWalletId: UNKNOWN_WALLET,
        amount: eur('2000'),
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a non-positive amount', async () => {
    const service = fundingService({ maxMinor: 1_000_000n });
    await expect(service.validateRequest(UNKNOWN_WALLET, eur('0'))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('rejects a non-EUR amount in Phase 1', async () => {
    const service = fundingService({ maxMinor: 1_000_000n });
    await expect(
      service.validateRequest(UNKNOWN_WALLET, { amount: '1000', currency: 'USD' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects an unknown target wallet before any ledger work', async () => {
    const service = fundingService({ maxMinor: 1_000_000n });
    await expect(service.validateRequest(UNKNOWN_WALLET, eur('1000'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
