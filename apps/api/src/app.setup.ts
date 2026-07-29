import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { ZodValidationPipe } from 'nestjs-zod';
import { CORRELATION_ID_HEADER, correlationIdMiddleware } from './common/correlation-id.middleware';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import type { Env } from './config/env';
import { CSRF_HEADER, TOKEN_TRANSPORT_HEADER } from './modules/identity/http/token-transport';
import { buildOpenApiDocument } from './openapi/build-document';

export const API_VERSION = '0.1.0';

/** Two years, the threshold the HSTS preload list requires. */
const HSTS_MAX_AGE_SECONDS = 63_072_000;

/**
 * Every response but `/docs` is JSON, so the API itself needs to load nothing:
 * the tightest possible policy is also the correct one.
 */
const API_CSP_DIRECTIVES = {
  'default-src': ["'none'"],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
} as const;

/**
 * Swagger UI is served from our own origin but ships inline styles and scripts,
 * so it needs a relaxed policy. Scoped to `/docs` alone rather than loosening
 * the policy that covers the money-moving surface.
 */
const DOCS_CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'unsafe-inline'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:'],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
} as const;

/**
 * Apply the platform HTTP policy (ADR-0021, extended by ADR-0027) to an
 * application instance: security headers, `/v1` prefix (the liveness probe and
 * the app-association documents stay unversioned), a correlation id on every
 * request, credentialed CORS restricted to the client origins, Zod validation,
 * the canonical error envelope, and the generated OpenAPI document at /docs.
 * Shared by main.ts and the HTTP test harness so tests exercise the
 * production pipeline.
 */
export function configureApp(app: INestApplication, env: Env): void {
  applySecurityHeaders(app);
  app.use(correlationIdMiddleware);
  app.setGlobalPrefix('v1', {
    exclude: ['health', '.well-known/apple-app-site-association', '.well-known/assetlinks.json'],
  });
  app.enableCors({
    origin: [...(env.CORS_ORIGINS ?? env.WEBAUTHN_ORIGINS)],
    // Required for the cookie transport mode: without it the browser neither
    // sends the session cookies nor exposes the response to script (ADR-0027).
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      CORRELATION_ID_HEADER,
      CSRF_HEADER,
      TOKEN_TRANSPORT_HEADER,
    ],
    exposedHeaders: [CORRELATION_ID_HEADER],
  });
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();
  SwaggerModule.setup('docs', app, buildOpenApiDocument(env.APP_NAME, API_VERSION));
}

/**
 * Security headers (ADR-0027). HSTS is emitted unconditionally: browsers ignore
 * it over plain HTTP, so it costs nothing locally and is present the moment TLS
 * terminates in front of the API.
 */
function applySecurityHeaders(app: INestApplication): void {
  app.use(
    helmet({
      // Applied separately below, because /docs needs different directives.
      contentSecurityPolicy: false,
      hsts: { maxAge: HSTS_MAX_AGE_SECONDS, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'no-referrer' },
      // The API is read cross-origin by the web client under CORS, which is the
      // control that actually governs access here; leaving CORP at `same-origin`
      // would block legitimate cross-origin reads without adding protection.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const docsCsp = helmet.contentSecurityPolicy({ directives: { ...DOCS_CSP_DIRECTIVES } });
  const apiCsp = helmet.contentSecurityPolicy({ directives: { ...API_CSP_DIRECTIVES } });
  app.use((request: { path?: string }, response: unknown, next: () => void) =>
    (request.path?.startsWith('/docs') ? docsCsp : apiCsp)(
      request as never,
      response as never,
      next,
    ),
  );
}
