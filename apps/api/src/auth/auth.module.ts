import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../database/database.module';
import { normalizeEmail } from '../normalize-email';
import { AuthStateCleanupService } from './auth-state-cleanup.service';
import { AuthController } from './auth.controller';
import { ACCESS_TOKEN_SECONDS, AuthService } from './auth.service';
import { AuthGuard } from './guards/auth.guard';
import { AuthRepository } from './repositories/auth.repository';
import { PostgresThrottlerStorage } from './throttling/postgres-throttler.storage';

@Module({
  imports: [DatabaseModule],
  providers: [PostgresThrottlerStorage],
  exports: [PostgresThrottlerStorage],
})
export class PostgresThrottlerStorageModule {}

@Module({
  imports: [
    DatabaseModule,
    ConfigModule,
    PostgresThrottlerStorageModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: `${ACCESS_TOKEN_SECONDS}s`,
          issuer: config.get<string>('JWT_ISSUER') ?? 'serp-api',
          audience: config.get<string>('JWT_AUDIENCE') ?? 'serp-web',
          algorithm: 'HS256',
        },
        verifyOptions: {
          issuer: config.get<string>('JWT_ISSUER') ?? 'serp-api',
          audience: config.get<string>('JWT_AUDIENCE') ?? 'serp-web',
          algorithms: ['HS256'],
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [PostgresThrottlerStorageModule],
      inject: [PostgresThrottlerStorage],
      useFactory: (storage: PostgresThrottlerStorage) => ({
        storage,
        throttlers: [
          { name: 'ip', limit: 20, ttl: 15 * 60 * 1000 },
          {
            name: 'account',
            limit: 5,
            ttl: 15 * 60 * 1000,
            getTracker: (req: Record<string, unknown>) => {
              const body = req.body as { email?: unknown } | undefined;
              return typeof body?.email === 'string' && body.email.length <= 320
                ? normalizeEmail(body.email)
                : `invalid:${String(req.ip ?? 'unknown')}`;
            },
          },
        ],
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthRepository,
    AuthService,
    AuthGuard,
    ThrottlerGuard,
    AuthStateCleanupService,
  ],
  exports: [AuthService, AuthGuard, JwtModule],
})
export class AuthModule {}