import {
  createOpenApiRegistry,
  generateOpenApiDocument,
  HealthResponseSchema,
} from '@fides/contracts';
import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * Build the OpenAPI document from the Zod-first contracts. Routes are registered
 * here as they are added; the document is the single source served at /docs.
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

  const document = generateOpenApiDocument(registry, { title: `${appName} API`, version });
  return document as unknown as OpenAPIObject;
}
