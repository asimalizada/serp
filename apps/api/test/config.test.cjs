const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateAppConfig, findEnvPath } = require('../dist/app-config.js');

test('findEnvPath discovers .env file in project hierarchy', () => {
  const envPath = findEnvPath();
  assert.ok(envPath, 'findEnvPath should locate a .env file');
  assert.match(envPath, /\.env$/);
});

test('validateAppConfig accepts valid development configuration and applies defaults', () => {
  const input = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/mydb',
    JWT_SECRET: 'a'.repeat(32),
  };

  const config = validateAppConfig(input);
  assert.equal(config.DATABASE_URL, 'postgresql://user:pass@localhost:5432/mydb');
  assert.equal(config.NODE_ENV, 'development');
  assert.equal(config.API_PORT, 3001);
  assert.equal(config.TRUST_PROXY_HOPS, 0);
  assert.equal(config.API_ORIGIN, 'http://localhost:3001');
  assert.equal(config.WEB_ORIGIN, 'http://localhost:3000');
  assert.equal(config.JWT_ISSUER, 'serp-api');
  assert.equal(config.JWT_AUDIENCE, 'serp-web');
});

test('validateAppConfig supports PORT environment variable fallback for API_PORT', () => {
  const input = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/mydb',
    JWT_SECRET: 'b'.repeat(32),
    PORT: '8080',
  };

  const config = validateAppConfig(input);
  assert.equal(config.API_PORT, 8080);
  assert.equal(config.API_ORIGIN, 'http://localhost:8080');
});

test('validateAppConfig rejects missing or invalid DATABASE_URL', () => {
  assert.throws(
    () => validateAppConfig({ JWT_SECRET: 'a'.repeat(32) }),
    /DATABASE_URL is required/,
  );

  assert.throws(
    () => validateAppConfig({ DATABASE_URL: 'not-a-url', JWT_SECRET: 'a'.repeat(32) }),
    /DATABASE_URL must be a valid URL/,
  );

  assert.throws(
    () => validateAppConfig({ DATABASE_URL: 'mysql://user:pass@localhost:3306/db', JWT_SECRET: 'a'.repeat(32) }),
    /DATABASE_URL must use postgresql: or postgres: protocol/,
  );
});

test('validateAppConfig rejects missing or short JWT_SECRET', () => {
  assert.throws(
    () => validateAppConfig({ DATABASE_URL: 'postgresql://localhost:5432/db' }),
    /JWT_SECRET is required and must be at least 32 characters long/,
  );

  assert.throws(
    () => validateAppConfig({ DATABASE_URL: 'postgresql://localhost:5432/db', JWT_SECRET: 'too-short' }),
    /JWT_SECRET is required and must be at least 32 characters long/,
  );
});

test('validateAppConfig rejects example JWT_SECRET placeholder in production', () => {
  assert.throws(
    () =>
      validateAppConfig({
        DATABASE_URL: 'postgresql://localhost:5432/db',
        JWT_SECRET: 'replace-with-a-secure-secret-at-least-32-characters-long',
        NODE_ENV: 'production',
        API_ORIGIN: 'https://api.example.com',
        WEB_ORIGIN: 'https://example.com',
      }),
    /JWT_SECRET cannot use example placeholder in production/,
  );
});

test('validateAppConfig enforces HTTPS origins in production', () => {
  assert.throws(
    () =>
      validateAppConfig({
        DATABASE_URL: 'postgresql://localhost:5432/db',
        JWT_SECRET: 'c'.repeat(32),
        NODE_ENV: 'production',
        API_ORIGIN: 'http://api.example.com',
        WEB_ORIGIN: 'https://example.com',
      }),
    /Production API_ORIGIN and WEB_ORIGIN must use HTTPS/,
  );

  assert.throws(
    () =>
      validateAppConfig({
        DATABASE_URL: 'postgresql://localhost:5432/db',
        JWT_SECRET: 'c'.repeat(32),
        NODE_ENV: 'production',
        API_ORIGIN: 'https://api.example.com',
        WEB_ORIGIN: 'http://example.com',
      }),
    /Production API_ORIGIN and WEB_ORIGIN must use HTTPS/,
  );
});

test('validateAppConfig validates port and proxy hops ranges', () => {
  assert.throws(
    () =>
      validateAppConfig({
        DATABASE_URL: 'postgresql://localhost:5432/db',
        JWT_SECRET: 'd'.repeat(32),
        API_PORT: 99999,
      }),
    /API_PORT must be a valid TCP port/,
  );

  assert.throws(
    () =>
      validateAppConfig({
        DATABASE_URL: 'postgresql://localhost:5432/db',
        JWT_SECRET: 'd'.repeat(32),
        TRUST_PROXY_HOPS: -1,
      }),
    /TRUST_PROXY_HOPS must be an integer between 0 and 10/,
  );
});

test('validateAppConfig rejects invalid origin formats (path, query, credentials)', () => {
  assert.throws(
    () =>
      validateAppConfig({
        DATABASE_URL: 'postgresql://localhost:5432/db',
        JWT_SECRET: 'e'.repeat(32),
        WEB_ORIGIN: 'https://example.com/some/path',
      }),
    /WEB_ORIGIN must be an HTTP\(S\) origin without path, credentials, or query/,
  );

  assert.throws(
    () =>
      validateAppConfig({
        DATABASE_URL: 'postgresql://localhost:5432/db',
        JWT_SECRET: 'e'.repeat(32),
        WEB_ORIGIN: 'https://user:pass@example.com',
      }),
    /WEB_ORIGIN must be an HTTP\(S\) origin without path, credentials, or query/,
  );
});
