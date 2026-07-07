import { Controller, Get, Inject } from '@nestjs/common';
import type { HealthResponseDto } from '@fides/contracts';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  // Explicit tokens: esbuild-based test transforms emit no design:paramtypes.
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  check(): HealthResponseDto {
    return this.health.check();
  }
}
