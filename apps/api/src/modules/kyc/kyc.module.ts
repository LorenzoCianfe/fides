import { Module } from '@nestjs/common';
import type { IdGenerator } from '@fides/domain';
import { ID_GENERATOR } from '../../shared/tokens';
import { KYC_PORT } from './application/kyc.port';
import { MockKycAdapter } from './infra/mock-kyc.adapter';

/** Binds the KYC port to its development adapter (auto-approve, ADR-0008). */
@Module({
  providers: [
    {
      provide: KYC_PORT,
      useFactory: (ids: IdGenerator): MockKycAdapter => new MockKycAdapter(ids),
      inject: [ID_GENERATOR],
    },
  ],
  exports: [KYC_PORT],
})
export class KycModule {}
