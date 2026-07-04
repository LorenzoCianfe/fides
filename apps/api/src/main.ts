import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import { loadEnv } from './config/env';
import { buildOpenApiDocument } from './openapi/build-document';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();

  SwaggerModule.setup('docs', app, buildOpenApiDocument(env.APP_NAME, '0.1.0'));

  await app.listen(env.API_PORT);
  new Logger('Bootstrap').log(
    `${env.APP_NAME} API listening on :${env.API_PORT} (OpenAPI at /docs)`,
  );
}

void bootstrap();
