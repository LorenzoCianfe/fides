import { Inject, Injectable } from '@nestjs/common';
import type { HealthResponseDto } from '@fides/contracts';
import { ENV, type Env } from '../config/env';

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(@Inject(ENV) private readonly env: Env) {}

  check(): HealthResponseDto {
    return {
      status: 'ok',
      service: `${this.env.APP_NAME.toLowerCase()}-api`,
      version: '0.1.0',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}
