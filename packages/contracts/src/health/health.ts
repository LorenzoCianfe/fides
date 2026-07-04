import { z } from '../zod';

/** Response contract for the API liveness endpoint. */
export const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    service: z.string().openapi({ example: 'fides-api' }),
    version: z.string().openapi({ example: '0.1.0' }),
    uptimeSeconds: z.number().nonnegative(),
    timestamp: z.string().datetime(),
  })
  .openapi('HealthResponse');

export type HealthResponseDto = z.infer<typeof HealthResponseSchema>;
