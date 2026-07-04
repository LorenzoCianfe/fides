import { Module } from '@nestjs/common';
import { EnvModule } from './config/env.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [EnvModule, DatabaseModule, HealthModule],
})
export class AppModule {}
