import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import { CORRELATION_ID_HEADER, correlationIdMiddleware } from './common/correlation-id.middleware';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import type { Env } from './config/env';
import { buildOpenApiDocument } from './openapi/build-document';

export const API_VERSION = '0.1.0';

/**
 * Apply the platform HTTP policy (ADR-0021) to an application instance:
 * `/v1` prefix (the liveness probe stays unversioned), a correlation id on
 * every request, CORS restricted to the client origins, Zod validation, the
 * canonical error envelope, and the generated OpenAPI document at /docs.
 * Shared by main.ts and the HTTP test harness so tests exercise the
 * production pipeline.
 */
export function configureApp(app: INestApplication, env: Env): void {
  app.use(correlationIdMiddleware);
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.enableCors({
    origin: [...(env.CORS_ORIGINS ?? env.WEBAUTHN_ORIGINS)],
    exposedHeaders: [CORRELATION_ID_HEADER],
  });
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();
  SwaggerModule.setup('docs', app, buildOpenApiDocument(env.APP_NAME, API_VERSION));
}
