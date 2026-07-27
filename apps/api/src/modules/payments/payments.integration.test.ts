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

const principal = {
  userId: '00000000-0000-7000-8000-000000000001',
  sessionId: '00000000-0000-7000-8000-000000000002',
  deviceId: '00000000-0000-7000-8000-000000000003',
  userStatus: 'active' as const,
};

function fundingService(config: FundingConfig): FundingService {
  return new FundingService(ledger, posting, wallets, ids, clock, config, audit);
}

function eur(minor: string) {
  return { amount: minor, currency: 'EUR' as const };
}

/**
 * The dev funding faucet's gate (kill-switch, cap, currency) short-circuits
 * before any wallet or ledger work, so these assertions need no provisioned
 * state. The funding money-path itself is proven end to end in the HTTP suite.
 */
describe('dev funding gating (integration)', () => {
  afterAll(async () => {
    await close();
  });

  it('answers 404 when the faucet is disabled', async () => {
    const service = fundingService({ enabled: false, maxMinor: 1_000_000n });
    await expect(
      service.fund({ principal, amount: eur('1000'), idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an amount above the configured maximum', async () => {
    const service = fundingService({ enabled: true, maxMinor: 1_000n });
    await expect(
      service.fund({ principal, amount: eur('2000'), idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a non-positive amount', async () => {
    const service = fundingService({ enabled: true, maxMinor: 1_000_000n });
    await expect(
      service.fund({ principal, amount: eur('0'), idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a non-EUR amount in Phase 1', async () => {
    const service = fundingService({ enabled: true, maxMinor: 1_000_000n });
    await expect(
      service.fund({
        principal,
        amount: { amount: '1000', currency: 'USD' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
