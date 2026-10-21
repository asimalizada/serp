import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './api-exception.filter';
import { apiOrigins } from './app-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = config.getOrThrow<number>('API_PORT');
  app.getHttpAdapter().getInstance().set('trust proxy', config.getOrThrow<number>('TRUST_PROXY_HOPS'));
  const allowedOrigins = new Set(apiOrigins(config));
  app.enableCors({ origin: [...allowedOrigins], credentials: true });
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      const origin = request.headers.origin;
      const hasAuthCookie = request.headers.cookie
        ?.split(';')
        .some((part) => {
          const trimmed = part.trim();
          return (
            trimmed.startsWith('serp_access=') ||
            trimmed.startsWith('serp_refresh=')
          );
        });
      if (
        (origin && !allowedOrigins.has(origin)) ||
        (!origin && (hasAuthCookie || request.path === '/auth/login' || request.path === '/auth/refresh'))
      ) {
        response.status(403).json({ statusCode: 403, error: 'Forbidden', message: 'Allowed Origin header required' });
        return;
      }
    }
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  await app.listen(port);
  const logger = new Logger('Bootstrap');
  logger.log(`Application listening on port ${port} in ${config.getOrThrow<string>('NODE_ENV')} mode`);
}

void bootstrap().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.stack : String(error), 'Bootstrap');
  process.exitCode = 1;
});