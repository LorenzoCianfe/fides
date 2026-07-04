import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { OpenAPIObject } from 'openapi3-ts/oas30';

/** Create an empty OpenAPI registry for route and schema registration. */
export function createOpenApiRegistry(): OpenAPIRegistry {
  return new OpenAPIRegistry();
}

export interface OpenApiInfo {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
}

/** Generate an OpenAPI 3.0 document from a populated registry. */
export function generateOpenApiDocument(
  registry: OpenAPIRegistry,
  info: OpenApiInfo,
): OpenAPIObject {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: info.title,
      version: info.version,
      ...(info.description !== undefined ? { description: info.description } : {}),
    },
  });
}

export { OpenAPIRegistry };
