import { Global, Module } from '@nestjs/common';
import { ENV, loadEnv } from './env';

/** Global module exposing the validated environment under the ENV token. */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class EnvModule {}
