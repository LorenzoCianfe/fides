import { Controller, Get } from '@nestjs/common';
import type { HealthResponseDto } from '@fides/contracts';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): HealthResponseDto {
    return this.health.check();
  }
}
