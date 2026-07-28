import { Module } from '@nestjs/common';
import { EnvModule } from './config/env.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuditModule } from './modules/audit/audit.module';
import { IdentityModule } from './modules/identity/identity.module';
import { KycModule } from './modules/kyc/kyc.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { OperationsModule } from './operations/operations.module';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [
    EnvModule,
    SharedModule,
    DatabaseModule,
    HealthModule,
    KycModule,
    LedgerModule,
    AuditModule,
    IdentityModule,
    AccountsModule,
    PaymentsModule,
    AdminModule,
    OperationsModule,
  ],
})
export class AppModule {}
