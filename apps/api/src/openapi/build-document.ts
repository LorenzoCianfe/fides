import {
  createOpenApiRegistry,
  generateOpenApiDocument,
  HealthResponseSchema,
  registerAccountPaths,
  registerAuthPaths,
  registerPaymentPaths,
} from '@fides/contracts';
import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * Build the OpenAPI document from the Zod-first contracts. Domain surfaces
 * register their paths via colocated registrars in @fides/contracts; the
 * document served at /docs is generated, never hand-maintained (ADR-0015).
 */
export function buildOpenApiDocument(appName: string, version: string): OpenAPIObject {
  const registry = createOpenApiRegistry();

  registry.registerPath({
    method: 'get',
    path: '/health',
    summary: 'Liveness probe',
    tags: ['system'],
    responses: {
      200: {
        description: 'Service is healthy',
        content: { 'application/json': { schema: HealthResponseSchema } },
      },
    },
  });

  registerAuthPaths(registry);
  registerAccountPaths(registry);
  registerPaymentPaths(registry);

  const document = generateOpenApiDocument(registry, { title: `${appName} API`, version });
  return document as unknown as OpenAPIObject;
}
