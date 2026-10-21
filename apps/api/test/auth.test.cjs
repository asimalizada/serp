const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hash } = require('bcryptjs');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { ConfigService, ConfigModule } = require('@nestjs/config');
const { JwtModule, JwtService } = require('@nestjs/jwt');
const { ThrottlerModule } = require('@nestjs/throttler');
const { loginSchema } = require('@serp/shared');
const {
  AuthService,
  ACCESS_TOKEN_SECONDS,
  REFRESH_TOKEN_SECONDS,
  tokenHash,
} = require('../dist/auth/auth.service.js');
const { AuthRepository } = require('../dist/auth/repositories/auth.repository.js');
const { AuthGuard, accessToken, refreshToken } = require('../dist/auth/guards/auth.guard.js');
const { AuthController } = require('../dist/auth/auth.controller.js');
const { AuthStateCleanupService } = require('../dist/auth/auth-state-cleanup.service.js');
const { PostgresThrottlerStorage } = require('../dist/auth/throttling/postgres-throttler.storage.js');
const { ZodValidationPipe } = require('../dist/common/pipes/zod-validation.pipe.js');
const { ApiExceptionFilter } = require('../dist/api-exception.filter.js');

const TEST_JWT_SECRET = 'serp_test_secret_at_least_32_chars_long_1234567890';
const TEST_JWT_ISSUER = 'serp-api';
const TEST_JWT_AUDIENCE = 'serp-web';

function createMockConfig() {
  return {
    getOrThrow: (key) => {
      if (key === 'JWT_SECRET') return TEST_JWT_SECRET;
      if (key === 'NODE_ENV') return 'test';
      throw new Error(`Config key missing: ${key}`);
    },
    get: (key) => {
      if (key === 'JWT_ISSUER') return TEST_JWT_ISSUER;
      if (key === 'JWT_AUDIENCE') return TEST_JWT_AUDIENCE;
      if (key === 'NODE_ENV') return 'test';
      return undefined;
    },
  };
}

function createMockPrisma({ user = null, tokens = new Map(), sessions = null, throttles = new Map() } = {}) {
  const tokenStore = sessions || tokens;
  const client = {
    user: {
      findUnique: async ({ where }) => {
        if (user && where.email === user.email) return user;
        return null;
      },
    },
    refreshToken: {
      create: async ({ data }) => {
        tokenStore.set(data.tokenHash, { ...data });
        return data;
      },
      findUnique: async ({ where }) => {
        const item = tokenStore.get(where.tokenHash);
        if (!item) return null;
        return {
          expiresAt: item.expiresAt,
          user: user && user.id === item.userId
            ? { id: user.id, email: user.email, timezone: user.timezone }
            : { id: item.userId, email: 'user@example.com', timezone: 'UTC' },
        };
      },
      delete: async ({ where }) => {
        if (!tokenStore.has(where.tokenHash)) {
          const err = new Error('Record to delete does not exist');
          err.code = 'P2025';
          throw err;
        }
        tokenStore.delete(where.tokenHash);
      },
      deleteMany: async ({ where }) => {
        let count = 0;
        if (where.tokenHash) {
          if (tokenStore.delete(where.tokenHash)) count++;
        } else if (where.expiresAt && where.expiresAt.lt) {
          const threshold = where.expiresAt.lt;
          for (const [k, v] of tokenStore.entries()) {
            if (v.expiresAt < threshold) {
              tokenStore.delete(k);
              count++;
            }
          }
        }
        return { count };
      },
    },
    authThrottle: {
      deleteMany: async ({ where }) => {
        let count = 0;
        if (where.expiresAt && where.expiresAt.lt) {
          const threshold = where.expiresAt.lt;
          for (const [k, v] of throttles.entries()) {
            if (v.expiresAt < threshold) {
              throttles.delete(k);
              count++;
            }
          }
        }
        return { count };
      },
    },
    $transaction: async (fn) => fn(client),
  };
  return client;
}

// -------------------------------------------------------------
// 1. Zod login schema tests
// -------------------------------------------------------------

test('loginSchema validates standard valid login payload and normalizes email', () => {
  const result = loginSchema.safeParse({
    email: '  Admin@SERP.local  ',
    password: 'SuperSecretPassword123!',
  });
  assert.equal(result.success, true);
  assert.equal(result.data.email, 'admin@serp.local');
  assert.equal(result.data.password, 'SuperSecretPassword123!');
});

test('loginSchema rejects invalid email formats', () => {
  for (const badEmail of ['', '   ', 'not-an-email', 'missing@', '@missing.com', 'user@.com']) {
    const result = loginSchema.safeParse({ email: badEmail, password: 'password123' });
    assert.equal(result.success, false, `Expected failure for email: "${badEmail}"`);
  }
});

test('loginSchema rejects empty or missing password', () => {
  const emptyRes = loginSchema.safeParse({ email: 'user@example.com', password: '' });
  assert.equal(emptyRes.success, false);

  const missingRes = loginSchema.safeParse({ email: 'user@example.com' });
  assert.equal(missingRes.success, false);
});

test('loginSchema rejects unknown properties in strict mode', () => {
  const result = loginSchema.safeParse({
    email: 'user@example.com',
    password: 'password123',
    extraField: 'unexpected',
  });
  assert.equal(result.success, false);
  const issue = result.error.issues.find((i) => i.code === 'unrecognized_keys');
  assert.ok(issue);
  assert.ok(issue.keys.includes('extraField'));
});

test('loginSchema handles UTF-8 password byte-length boundaries (72-byte limit)', () => {
  const pass72 = 'a'.repeat(72);
  const res72 = loginSchema.safeParse({ email: 'user@example.com', password: pass72 });
  assert.equal(res72.success, true);

  const pass73 = 'a'.repeat(73);
  const res73 = loginSchema.safeParse({ email: 'user@example.com', password: pass73 });
  assert.equal(res73.success, false);

  const euro24 = '€'.repeat(24);
  const resEuro24 = loginSchema.safeParse({ email: 'user@example.com', password: euro24 });
  assert.equal(resEuro24.success, true);

  const euro25 = '€'.repeat(25);
  const resEuro25 = loginSchema.safeParse({ email: 'user@example.com', password: euro25 });
  assert.equal(resEuro25.success, false);
});

test('loginSchema preserves whitespace in password and never trims', () => {
  const passWithSpaces = '  spaces at both ends  ';
  const result = loginSchema.safeParse({ email: 'user@example.com', password: passWithSpaces });
  assert.equal(result.success, true);
  assert.equal(result.data.password, passWithSpaces);
});

// -------------------------------------------------------------
// 2. AuthRepository refresh token lifecycle unit tests
// -------------------------------------------------------------

test('AuthRepository methods: user lookup, refresh token rotation, revocation, and expired cleanup', async () => {
  const sessions = new Map();
  const user = {
    id: 'user-repo-1',
    email: 'test@serp.local',
    timezone: 'UTC',
    passwordHash: 'some-hash',
  };
  const prisma = createMockPrisma({ user, sessions });
  const repo = new AuthRepository(prisma);

  // 1. findUserByNormalizedEmail
  const found = await repo.findUserByNormalizedEmail('test@serp.local');
  assert.ok(found);
  assert.equal(found.id, user.id);
  assert.equal(await repo.findUserByNormalizedEmail('nonexistent@serp.local'), null);

  // 2. createRefreshToken
  const oldHash = 'old-refresh-token-hash';
  await repo.createRefreshToken({
    tokenHash: oldHash,
    userId: user.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.ok(sessions.has(oldHash));

  // 3. rotateRefreshToken succeeds on valid token
  const newHash = 'new-refresh-token-hash';
  const rotatedUser = await repo.rotateRefreshToken(
    oldHash,
    newHash,
    new Date(Date.now() + 120_000),
  );
  assert.ok(rotatedUser);
  assert.equal(rotatedUser.id, user.id);
  assert.equal(sessions.has(oldHash), false, 'Old token hash must be removed');
  assert.equal(sessions.has(newHash), true, 'New token hash must be stored');

  // 4. Replay of old token returns null
  const replayResult = await repo.rotateRefreshToken(
    oldHash,
    'another-hash',
    new Date(Date.now() + 120_000),
  );
  assert.equal(replayResult, null, 'Replay of rotated token must return null');

  // 5. Expired token rotation returns null
  sessions.get(newHash).expiresAt = new Date(Date.now() - 5000);
  const expiredResult = await repo.rotateRefreshToken(
    newHash,
    'next-hash',
    new Date(Date.now() + 120_000),
  );
  assert.equal(expiredResult, null, 'Expired token rotation must return null');

  // 6. revokeRefreshToken removes token
  sessions.set('revoke-hash', { tokenHash: 'revoke-hash', userId: user.id, expiresAt: new Date(Date.now() + 60_000) });
  await repo.revokeRefreshToken('revoke-hash');
  assert.equal(sessions.has('revoke-hash'), false);

  // 7. deleteExpiredRefreshTokens purges expired records
  sessions.set('exp-1', { tokenHash: 'exp-1', expiresAt: new Date(Date.now() - 10_000) });
  sessions.set('val-1', { tokenHash: 'val-1', expiresAt: new Date(Date.now() + 10_000) });
  const deleted = await repo.deleteExpiredRefreshTokens();
  assert.equal(deleted, 2); // exp-1 and the earlier expired newHash
  assert.equal(sessions.has('exp-1'), false);
  assert.equal(sessions.has('val-1'), true);
});

// -------------------------------------------------------------
// 3. Throttler & Cleanup maintenance unit tests
// -------------------------------------------------------------

test('PostgresThrottlerStorage.deleteExpiredThrottles deletes expired throttles and preserves active ones', async () => {
  const throttles = new Map();
  throttles.set('th-expired', { key: 'th-expired', expiresAt: new Date(Date.now() - 10_000) });
  throttles.set('th-active', { key: 'th-active', expiresAt: new Date(Date.now() + 10_000) });
  const prisma = createMockPrisma({ throttles });
  const storage = new PostgresThrottlerStorage(prisma);
  const count = await storage.deleteExpiredThrottles();
  assert.equal(count, 1);
  assert.equal(throttles.has('th-expired'), false);
  assert.equal(throttles.has('th-active'), true);
});

test('AuthStateCleanupService coordinates expired tokens and throttles cleanup', async () => {
  let tokensDeleted = false;
  let throttlesDeleted = false;
  const mockRepo = {
    deleteExpiredRefreshTokens: async () => {
      tokensDeleted = true;
      return 3;
    },
  };
  const mockStorage = {
    deleteExpiredThrottles: async () => {
      throttlesDeleted = true;
      return 2;
    },
  };
  const cleanupService = new AuthStateCleanupService(mockRepo, mockStorage);
  const result = await cleanupService.cleanupExpiredState();
  assert.equal(tokensDeleted, true);
  assert.equal(throttlesDeleted, true);
  assert.equal(result.refreshTokens, 3);
  assert.equal(result.throttles, 2);
});

test('AuthStateCleanupService handles dependency failures gracefully', async () => {
  const failingRepo = {
    deleteExpiredRefreshTokens: async () => {
      throw new Error('database connection lost');
    },
  };
  const mockStorage = {
    deleteExpiredThrottles: async () => 1,
  };
  const cleanupService = new AuthStateCleanupService(failingRepo, mockStorage);
  await assert.rejects(cleanupService.cleanupExpiredState(), /Authentication state cleanup failed/);
});

test('AuthStateCleanupService lifecycle: onApplicationBootstrap starts timer and onModuleDestroy clears it', async () => {
  let cleanupCalls = 0;
  const mockRepo = {
    deleteExpiredRefreshTokens: async () => {
      cleanupCalls++;
      return 0;
    },
  };
  const mockStorage = {
    deleteExpiredThrottles: async () => 0,
  };
  const cleanupService = new AuthStateCleanupService(mockRepo, mockStorage);
  await cleanupService.onApplicationBootstrap();
  assert.equal(cleanupCalls, 1, 'Initial cleanup should run on bootstrap');
  assert.ok(cleanupService.cleanupTimer, 'Timer should be active');

  cleanupService.onModuleDestroy();
  assert.equal(cleanupService.cleanupTimer, undefined, 'Timer should be cleared on destroy');
});

// -------------------------------------------------------------
// 4. AuthService unit tests
// -------------------------------------------------------------

test('AuthService login issues signed access JWT and creates refresh token', async () => {
  const sessions = new Map();
  const user = {
    id: 'user-auth-1',
    email: 'jwt.user@serp.local',
    timezone: 'America/Toronto',
    passwordHash: await hash('ValidPassword123!', 4),
  };
  const prisma = createMockPrisma({ user, sessions });
  const repo = new AuthRepository(prisma);
  const jwtService = new JwtService();
  const config = createMockConfig();
  const authService = new AuthService(repo, jwtService, config);

  const { user: loggedIn, accessToken, refreshToken } = await authService.login(
    '  JWT.USER@SERP.LOCAL  ',
    'ValidPassword123!',
  );

  assert.equal(loggedIn.id, user.id);
  assert.equal(loggedIn.email, user.email);
  assert.ok(accessToken, 'Access token JWT must be generated');
  assert.ok(refreshToken, 'Refresh token must be generated');
  assert.equal(refreshToken.length, 43, 'Refresh token must be 32-byte base64url');

  // Verify access JWT payload and signature
  const decoded = await jwtService.verifyAsync(accessToken, {
    secret: TEST_JWT_SECRET,
    issuer: TEST_JWT_ISSUER,
    audience: TEST_JWT_AUDIENCE,
  });
  assert.equal(decoded.sub, user.id);
  assert.equal(decoded.email, user.email);
  assert.equal(decoded.timezone, user.timezone);

  // Verify refresh token hash stored in DB
  const storedHash = tokenHash(refreshToken);
  assert.ok(sessions.has(storedHash));

  // Failed login attempts
  await assert.rejects(
    authService.login('jwt.user@serp.local', 'WrongPassword'),
    { status: 401 },
  );
  await assert.rejects(
    authService.login('unknown@serp.local', 'ValidPassword123!'),
    { status: 401 },
  );
  await assert.rejects(
    authService.login('jwt.user@serp.local', 'a'.repeat(73)),
    { status: 400 },
  );
});

test('AuthService refresh rotates refresh token and issues new access token', async () => {
  const sessions = new Map();
  const user = {
    id: 'user-refresh-1',
    email: 'refresh.user@serp.local',
    timezone: 'UTC',
    passwordHash: await hash('Password123!', 4),
  };
  const prisma = createMockPrisma({ user, sessions });
  const repo = new AuthRepository(prisma);
  const jwtService = new JwtService();
  const config = createMockConfig();
  const authService = new AuthService(repo, jwtService, config);

  const { refreshToken: originalRefresh } = await authService.login(user.email, 'Password123!');

  // Rotate token
  const refreshed = await authService.refresh(originalRefresh);
  assert.ok(refreshed.accessToken);
  assert.ok(refreshed.refreshToken);
  assert.notEqual(refreshed.refreshToken, originalRefresh);

  // Attempting to reuse original token fails
  await assert.rejects(authService.refresh(originalRefresh), { status: 401 });

  // Invalid formats rejected
  await assert.rejects(authService.refresh(undefined), { status: 401 });
  await assert.rejects(authService.refresh('too-short'), { status: 401 });
  await assert.rejects(authService.refresh('invalid characters inside token!!!!!!!!!'), { status: 401 });
});

// -------------------------------------------------------------
// 5. AuthGuard unit tests
// -------------------------------------------------------------

test('AuthGuard validates JWT signature and claims without querying database', async () => {
  const jwtService = new JwtService();
  const config = createMockConfig();
  const guard = new AuthGuard(jwtService, config);

  // 1. Valid JWT
  const validToken = await jwtService.signAsync(
    { sub: 'usr-1', email: 'guard@example.com', timezone: 'UTC' },
    {
      secret: TEST_JWT_SECRET,
      issuer: TEST_JWT_ISSUER,
      audience: TEST_JWT_AUDIENCE,
      expiresIn: '15m',
    },
  );

  const validReq = {
    headers: { cookie: `serp_access=${validToken}` },
  };
  const validCtx = { switchToHttp: () => ({ getRequest: () => validReq }) };
  assert.equal(await guard.canActivate(validCtx), true);
  assert.deepEqual(validReq.user, { id: 'usr-1', email: 'guard@example.com', timezone: 'UTC' });

  // 2. Missing token throws 401
  const emptyReq = { headers: {} };
  await assert.rejects(
    guard.canActivate({ switchToHttp: () => ({ getRequest: () => emptyReq }) }),
    { status: 401 },
  );

  // 3. Expired token throws 401
  const expiredToken = await jwtService.signAsync(
    { sub: 'usr-1', email: 'guard@example.com', timezone: 'UTC' },
    {
      secret: TEST_JWT_SECRET,
      issuer: TEST_JWT_ISSUER,
      audience: TEST_JWT_AUDIENCE,
      expiresIn: '-1s',
    },
  );
  const expiredReq = { headers: { cookie: `serp_access=${expiredToken}` } };
  await assert.rejects(
    guard.canActivate({ switchToHttp: () => ({ getRequest: () => expiredReq }) }),
    { status: 401 },
  );

  // 4. Token signed with wrong secret throws 401
  const fakeSecretToken = await jwtService.signAsync(
    { sub: 'usr-1', email: 'guard@example.com', timezone: 'UTC' },
    {
      secret: 'wrong_secret_123456789012345678901234567890',
      issuer: TEST_JWT_ISSUER,
      audience: TEST_JWT_AUDIENCE,
    },
  );
  const fakeReq = { headers: { cookie: `serp_access=${fakeSecretToken}` } };
  await assert.rejects(
    guard.canActivate({ switchToHttp: () => ({ getRequest: () => fakeReq }) }),
    { status: 401 },
  );

  // 5. Wrong issuer / audience throws 401
  const wrongAudToken = await jwtService.signAsync(
    { sub: 'usr-1', email: 'guard@example.com', timezone: 'UTC' },
    {
      secret: TEST_JWT_SECRET,
      issuer: 'wrong-issuer',
      audience: 'wrong-audience',
    },
  );
  const wrongAudReq = { headers: { cookie: `serp_access=${wrongAudToken}` } };
  await assert.rejects(
    guard.canActivate({ switchToHttp: () => ({ getRequest: () => wrongAudReq }) }),
    { status: 401 },
  );

  // 6. Supports Authorization Bearer header
  const bearerReq = { headers: { authorization: `Bearer ${validToken}` } };
  assert.equal(
    await guard.canActivate({ switchToHttp: () => ({ getRequest: () => bearerReq }) }),
    true,
  );
});

test('cookie token helpers extract access and refresh tokens properly', () => {
  const req = {
    headers: {
      cookie: 'foo=bar; serp_access=access123; serp_refresh=refresh456; baz=qux',
    },
  };
  assert.equal(accessToken(req), 'access123');
  assert.equal(refreshToken(req), 'refresh456');
});

// -------------------------------------------------------------
// 6. Real HTTP pipeline integration tests
// -------------------------------------------------------------

test('AuthController HTTP pipeline: login, access me, refresh rotation, replay rejection, and logout', async () => {
  const sessions = new Map();
  const testUser = {
    id: 'http-jwt-user-1',
    email: 'jwt.pipeline@serp.local',
    timezone: 'America/New_York',
    passwordHash: await hash('ValidPassword123!', 4),
  };

  const mockPrisma = createMockPrisma({ user: testUser, sessions });
  const repo = new AuthRepository(mockPrisma);
  const mockConfig = createMockConfig();

  class TestModule {}
  Module({
    imports: [
      ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
      JwtModule.register({
        secret: TEST_JWT_SECRET,
        signOptions: {
          expiresIn: `${ACCESS_TOKEN_SECONDS}s`,
          issuer: TEST_JWT_ISSUER,
          audience: TEST_JWT_AUDIENCE,
          algorithm: 'HS256',
        },
      }),
    ],
    controllers: [AuthController],
    providers: [
      { provide: AuthRepository, useValue: repo },
      {
        provide: AuthService,
        useFactory: (r, jwt, c) => new AuthService(r, jwt, c),
        inject: [AuthRepository, JwtService, ConfigService],
      },
      {
        provide: ConfigService,
        useValue: mockConfig,
      },
      AuthGuard,
    ],
  })(TestModule);

  const app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0);
  const port = app.getHttpServer().address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  function parseCookies(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    const cookies = {};
    for (const c of raw) {
      const [nameVal] = c.split(';');
      const [name, val] = nameVal.split('=');
      cookies[name.trim()] = val.trim();
    }
    return cookies;
  }

  function cookieHeader(cookies) {
    return Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  try {
    // 1. POST /auth/login with valid credentials
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: '  JWT.PIPELINE@SERP.LOCAL  ',
        password: 'ValidPassword123!',
      }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.equal(loginData.user.id, testUser.id);
    assert.equal(loginData.user.email, testUser.email);
    assert.equal(loginData.accessToken, undefined, 'Access token must not be in response body');
    assert.equal(loginData.refreshToken, undefined, 'Refresh token must not be in response body');

    const cookies = parseCookies(loginRes);
    assert.ok(cookies.serp_access, 'serp_access cookie must be set');
    assert.ok(cookies.serp_refresh, 'serp_refresh cookie must be set');

    // 2. GET /auth/me with serp_access cookie succeeds
    const meRes = await fetch(`${baseUrl}/auth/me`, {
      headers: { cookie: `serp_access=${cookies.serp_access}` },
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.user.id, testUser.id);
    assert.equal(meData.user.email, testUser.email);

    // 3. GET /auth/me without cookie fails with 401
    const unauthRes = await fetch(`${baseUrl}/auth/me`);
    assert.equal(unauthRes.status, 401);

    // 4. POST /auth/refresh with serp_refresh cookie rotates tokens
    const oldRefreshToken = cookies.serp_refresh;
    const refreshRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `serp_refresh=${oldRefreshToken}` },
    });
    assert.equal(refreshRes.status, 200);
    const refreshData = await refreshRes.json();
    assert.equal(refreshData.success, true);

    const refreshedCookies = parseCookies(refreshRes);
    assert.ok(refreshedCookies.serp_access);
    assert.ok(refreshedCookies.serp_refresh);
    assert.notEqual(refreshedCookies.serp_refresh, oldRefreshToken);

    // 5. Access /auth/me with newly issued access token
    const meAfterRefresh = await fetch(`${baseUrl}/auth/me`, {
      headers: { cookie: `serp_access=${refreshedCookies.serp_access}` },
    });
    assert.equal(meAfterRefresh.status, 200);

    // 6. Replay attempt: Reusing the old refresh token fails with 401
    const replayRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `serp_refresh=${oldRefreshToken}` },
    });
    assert.equal(replayRes.status, 401);

    // 7. Concurrent refresh attempts with the current token
    const currentRefreshToken = refreshedCookies.serp_refresh;
    const [c1, c2] = await Promise.all([
      fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { cookie: `serp_refresh=${currentRefreshToken}` },
      }),
      fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { cookie: `serp_refresh=${currentRefreshToken}` },
      }),
    ]);
    const statuses = [c1.status, c2.status].sort();
    assert.deepEqual(statuses, [200, 401], 'Exactly one concurrent refresh must succeed and one must fail');

    // Get the survivor's new refresh token
    const survivorRes = c1.status === 200 ? c1 : c2;
    const survivorCookies = parseCookies(survivorRes);

    // 8. POST /auth/logout clears cookies and revokes refresh token
    const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { cookie: cookieHeader(survivorCookies) },
    });
    assert.equal(logoutRes.status, 200);
    const logoutCookiesRaw = logoutRes.headers.getSetCookie
      ? logoutRes.headers.getSetCookie()
      : [logoutRes.headers.get('set-cookie')];
    assert.ok(logoutCookiesRaw.some((c) => c.includes('serp_access=;') || c.includes('Max-Age=0') || c.includes('Expires=Thu, 01 Jan 1970')));
    assert.ok(logoutCookiesRaw.some((c) => c.includes('serp_refresh=;') || c.includes('Max-Age=0') || c.includes('Expires=Thu, 01 Jan 1970')));

    // 9. Refreshing with the logged-out refresh token fails with 401
    const postLogoutRefresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `serp_refresh=${survivorCookies.serp_refresh}` },
    });
    assert.equal(postLogoutRefresh.status, 401);
  } finally {
    await app.close();
  }
});