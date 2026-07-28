import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);

  configureApp(app, env);

  await app.listen(env.API_PORT);
  new Logger('Bootstrap').log(
    `${env.APP_NAME} API listening on :${env.API_PORT} (OpenAPI at /docs)`,
  );
}

void bootstrap();
