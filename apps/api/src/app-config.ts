import fs from 'node:fs';
import path from 'node:path';
import { ConfigModule, ConfigService } from '@nestjs/config';

export function findEnvPath(): string | undefined {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(__dirname, '../../../.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '.env'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function parseOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password) {
    throw new Error(`${name} must be an HTTP(S) origin without path, credentials, or query`);
  }
  return value;
}

export function validateAppConfig(env: Record<string, unknown>): Record<string, unknown> {
  // 1. DATABASE_URL validation
  if (typeof env.DATABASE_URL !== 'string' || !env.DATABASE_URL.trim()) {
    throw new Error('DATABASE_URL is required');
  }
  let dbUrl: URL;
  try {
    dbUrl = new URL(env.DATABASE_URL.trim());
  } catch {
    throw new Error('DATABASE_URL must be a valid URL');
  }
  if (!['postgresql:', 'postgres:'].includes(dbUrl.protocol)) {
    throw new Error('DATABASE_URL must use postgresql: or postgres: protocol');
  }

  // 2. NODE_ENV validation
  const nodeEnv = String(env.NODE_ENV ?? 'development').trim();
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be one of: development, test, production');
  }

  // 3. JWT_SECRET validation
  if (typeof env.JWT_SECRET !== 'string' || env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET is required and must be at least 32 characters long');
  }
  if (nodeEnv === 'production' && env.JWT_SECRET.includes('replace-with-a-secure-secret')) {
    throw new Error('JWT_SECRET cannot use example placeholder in production');
  }

  // 4. Port validation (support API_PORT or standard PORT)
  const port = Number(env.API_PORT ?? env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be a valid TCP port (1-65535)');
  }

  // 5. Proxy hops validation
  const proxyHops = Number(env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 10) {
    throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 10');
  }

  // 6. Origin validation
  const apiOrigin = parseOrigin(String(env.API_ORIGIN ?? `http://localhost:${port}`), 'API_ORIGIN');
  const webOrigin = parseOrigin(String(env.WEB_ORIGIN ?? 'http://localhost:3000'), 'WEB_ORIGIN');

  if (nodeEnv === 'production') {
    if (!apiOrigin.startsWith('https://') || !webOrigin.startsWith('https://')) {
      throw new Error('Production API_ORIGIN and WEB_ORIGIN must use HTTPS');
    }
  }

  const jwtIssuer = String(env.JWT_ISSUER ?? 'serp-api').trim();
  if (!jwtIssuer) throw new Error('JWT_ISSUER cannot be empty');

  const jwtAudience = String(env.JWT_AUDIENCE ?? 'serp-web').trim();
  if (!jwtAudience) throw new Error('JWT_AUDIENCE cannot be empty');

  return {
    ...env,
    DATABASE_URL: env.DATABASE_URL.trim(),
    NODE_ENV: nodeEnv,
    API_PORT: port,
    TRUST_PROXY_HOPS: proxyHops,
    API_ORIGIN: apiOrigin,
    WEB_ORIGIN: webOrigin,
    JWT_SECRET: env.JWT_SECRET,
    JWT_ISSUER: jwtIssuer,
    JWT_AUDIENCE: jwtAudience,
  };
}

const envFilePath = findEnvPath();

export const AppConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  envFilePath: envFilePath ? [envFilePath] : [],
  validate: validateAppConfig,
});

export function apiOrigins(config: ConfigService): string[] {
  return [config.getOrThrow<string>('WEB_ORIGIN'), config.getOrThrow<string>('API_ORIGIN')];
}